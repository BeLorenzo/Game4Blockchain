/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { WeeklyGameClient } from '../contracts/WeeklyGame'
import { config } from '../config'
import { useAlert } from '../context/AlertContext'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { createCommit, getPhase, handleTimeout, notifyUpdate } from './gameUtils'

export type WeeklyPhase = 'WAITING' | 'COMMIT' | 'REVEAL' | 'ENDED'

export type WeeklySession = {
  id: number
  phase: WeeklyPhase
  fee: number
  playersCount: number
  totalPot: number
  canJoin: boolean
  canReveal: boolean
  canClaim: boolean
  hasPlayed: boolean
  hasRevealed: boolean
  myDay?: number | null
  claimResult?: { amount: number; timestamp: number; isTimeout?: boolean } | null // ✅ AGGIUNTO isTimeout
  dayCounts: number[]
  rounds: { start: number; endCommit: number; endReveal: number; current: number }
}

export const useWeeklyGame = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const { showAlert } = useAlert()

  const [loading, setLoading] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const [activeSessions, setActiveSessions] = useState<WeeklySession[]>([])
  const [historySessions, setHistorySessions] = useState<WeeklySession[]>([])
  const [mySessions, setMySessions] = useState<WeeklySession[]>([])
  const [mbrs, setMbrs] = useState({ create: 0, join: 0 })

  const appId = config.games.weeklyGame.appId

  const getStorageKey = useCallback(
    (sessionId: number) => activeAddress ? `weekly_${appId}_${activeAddress}_${sessionId}` : null,
    [activeAddress, appId],
  )

  const getClient = useCallback(() => {
    const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
    algorand.setDefaultSigner(transactionSigner)
    return new WeeklyGameClient({ algorand, appId })
  }, [transactionSigner, appId])

  // --- DATA FETCHING ---
  const refreshData = useCallback(async () => {
    if (!appId || appId === 0n) return

    try {
      const client = getClient()
      const algorand = client.algorand

      if (mbrs.create === 0) {
        try {
          const composer = client.newGroup()
          const simulatorSender = activeAddress ?? client.appAddress
          composer.getRequiredMbr({ args: { command: 'newGame' }, sender: simulatorSender })
          composer.getRequiredMbr({ args: { command: 'join' }, sender: simulatorSender })
          const result = await composer.simulate({ allowUnnamedResources: true })
          if (result.returns[0] !== undefined && result.returns[1] !== undefined) {
            setMbrs({
              create: Number(result.returns[0]) / 1e6,
              join: Number(result.returns[1]) / 1e6,
            })
          }
        } catch (e) {
          console.warn('Weekly MBR sim failed', e)
        }
      }

      const boxSessions = await client.state.box.gameSessions.getMap()
      const boxBalances = await client.state.box.sessionBalances.getMap()
      const boxDays = await client.state.box.days.getMap()

      const status = await algorand.client.algod.status().do()
      const currentRound = Number(status['lastRound'])

      const allSessions: WeeklySession[] = []

      for (const [key, conf] of boxSessions.entries()) {
        const id = Number(key)
        const balance = boxBalances.get(key)
        const dayObj = boxDays.get(key)

        const dayCounts = dayObj ? [
          Number(dayObj.lun), Number(dayObj.mar), Number(dayObj.mer), Number(dayObj.gio),
          Number(dayObj.ven), Number(dayObj.sab), Number(dayObj.dom)
        ] : [0, 0, 0, 0, 0, 0, 0]

        const start = Number(conf.startAt)
        const endCommit = Number(conf.endCommitAt)
        const endReveal = Number(conf.endRevealAt)
        const fee = Number(conf.participation) / 1e6
        const totalPot = balance ? Number(balance) / 1e6 : 0

        const revealedCount = dayCounts.reduce((a, b) => a + b, 0)
        let playersCount = revealedCount
        if (currentRound <= endCommit && fee > 0) {
          playersCount = Math.floor(totalPot / fee)
        }

        // Usa utility per calcolare fase
        const phase = getPhase(currentRound, start, endCommit, endReveal)

        const myKey = getStorageKey(id)
        const localJson = myKey ? localStorage.getItem(myKey) : null
        let myDay: number | null = null
        let hasRevealed = false
        let claimResult = null

        if (localJson) {
          try {
            const parsed = JSON.parse(localJson)
            myDay = parsed.day
            hasRevealed = !!parsed.hasRevealed
            claimResult = parsed.claimResult || null
          } catch {}
        }

        const hasPlayed = !!localJson

        claimResult = handleTimeout(
          myKey,
          fee,
          hasPlayed,
          hasRevealed,
          claimResult,
          currentRound,
          endReveal
        )

        const canJoin = phase === 'COMMIT' && !hasPlayed && !!activeAddress
        const canReveal = phase === 'REVEAL' && hasPlayed && !hasRevealed
        const canClaim = (phase === 'ENDED' || currentRound > endReveal) && hasRevealed && !claimResult

        allSessions.push({
          id, phase, fee, playersCount, totalPot,
          canJoin, canReveal, canClaim, hasPlayed, hasRevealed, myDay, claimResult,
          dayCounts,
          rounds: { start, endCommit, endReveal, current: currentRound }
        })
      }

      const sorted = allSessions.sort((a, b) => b.id - a.id)
      setActiveSessions(sorted.filter((s) => s.phase !== 'ENDED'))
      setHistorySessions(sorted.filter((s) => s.phase === 'ENDED'))
      setMySessions(sorted.filter((s) => s.hasPlayed))

    } catch (e: any) {
      console.error('Weekly Fetch error:', e)
    } finally {
      setIsInitializing(false)
    }
  }, [appId, activeAddress, getClient, mbrs.create, getStorageKey])

  // --- ACTIONS ---

  const createSession = async (fee: number, startDelay: number, commitLen: number, revealLen: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect wallet')
      const client = getClient()
      const algorand = client.algorand
      const status = await algorand.client.algod.status().do()
      const currentRound = BigInt(status['lastRound'])
      const startAt = currentRound + BigInt(startDelay)
      const endCommitAt = startAt + BigInt(commitLen)
      const endRevealAt = endCommitAt + BigInt(revealLen)
      const payment = await algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.Algos(mbrs.create)
      })

      await client.send.createSession({
        args: {
          config: { startAt, endCommitAt, endRevealAt, participation: BigInt(AlgoAmount.Algos(fee).microAlgos) },
          mbrPayment: { txn: payment, signer: transactionSigner }
        },
        sender: activeAddress,
        populateAppCallResources: true
      })

      showAlert('Weekly Session Created', 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const joinSession = async (sessionId: number, fee: number, day: number) => {
    setLoading(true)
    try {
      // Validazione input
      if (day === undefined || day === null || isNaN(day)) {
        throw new Error('Please select a valid day.')
      }
      if (day < 0 || day > 6) {
        throw new Error('Invalid Day: Must be between 0 (MON) and 6 (SUN).')
      }

      if (!activeAddress) throw new Error('Connect wallet')
      const client = getClient()
      const algorand = client.algorand

      // Usa utility per commit
      const { commitHash, salt } = await createCommit(day, 32)

      const feePayment = await algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.Algos(fee)
      })

      await client.send.joinSession({
        args: { sessionId: BigInt(sessionId), commit: commitHash, payment: { txn: feePayment, signer: transactionSigner } },
        sender: activeAddress,
        populateAppCallResources: true
      })

      const key = getStorageKey(sessionId)
      if (key) localStorage.setItem(key, JSON.stringify({ day, salt: Array.from(salt), hasRevealed: false }))

      notifyUpdate()
      showAlert('Ticket Bought!', 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const revealMove = async (sessionId: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect wallet')
      const key = getStorageKey(sessionId)
      const stored = key ? localStorage.getItem(key) : null
      if (!stored) throw new Error('No local data')
      const { day, salt } = JSON.parse(stored)
      const client = getClient()

      await client.send.revealMove({
        args: { sessionId: BigInt(sessionId), choice: BigInt(day), salt: new Uint8Array(salt) },
        sender: activeAddress,
        populateAppCallResources: true
      })

      const update = JSON.parse(stored)
      update.hasRevealed = true
      localStorage.setItem(key!, JSON.stringify(update))
      showAlert('Day Revealed!', 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const claimWinnings = async (sessionId: number, fee: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect wallet')
      const client = getClient()

      const result = await client.send.claimWinnings({
        args: { sessionId: BigInt(sessionId) },
        sender: activeAddress,
        populateAppCallResources: true,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000)
      })

      const grossPayout = Number(result.return) / 1e6
      const netProfit = grossPayout - fee

      const key = getStorageKey(sessionId)
      if (key) {
        const stored = JSON.parse(localStorage.getItem(key) || '{}')
        stored.claimResult = { amount: netProfit, timestamp: Date.now() }
        localStorage.setItem(key, JSON.stringify(stored))
        notifyUpdate()
      }

      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshData()
    const i = setInterval(refreshData, 5000)
    return () => clearInterval(i)
  }, [refreshData, activeAddress])

  return {
    activeSessions,
    historySessions,
    mySessions,
    mbrs,
    loading,
    isInitializing,
    createSession,
    joinSession,
    revealMove,
    claimWinnings
  }
}
