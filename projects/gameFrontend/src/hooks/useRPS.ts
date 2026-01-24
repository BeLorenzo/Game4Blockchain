/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { RockPaperScissorsClient } from '../contracts/RockPaperScissors'
import { config } from '../config'
import { useAlert } from '../context/AlertContext'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { createCommit, getPhase, handleTimeout, notifyUpdate } from './gameUtils'

export type RPSPhase = 'WAITING' | 'COMMIT' | 'REVEAL' | 'ENDED'

export type RPSSession = {
  id: number
  phase: RPSPhase
  fee: number
  totalPot: number
  playersCount: number
  player1: string
  player2: string
  canJoin: boolean
  canReveal: boolean
  canClaim: boolean
  hasPlayed: boolean
  hasRevealed: boolean
  myMove?: number | null
  claimResult?: { amount: number; timestamp: number; isTimeout?: boolean } | null
  rounds: { start: number; endCommit: number; endReveal: number; current: number }
}

export const useRPS = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const { showAlert } = useAlert()

  const [loading, setLoading] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const [activeSessions, setActiveSessions] = useState<RPSSession[]>([])
  const [historySessions, setHistorySessions] = useState<RPSSession[]>([])
  const [mySessions, setMySessions] = useState<RPSSession[]>([])
  const [mbrs, setMbrs] = useState({ create: 0, join: 0 })

  const appId = config.games.rps.appId

  const getStorageKey = useCallback(
    (sessionId: number) => activeAddress ? `rps_${appId}_${activeAddress}_${sessionId}` : null,
    [activeAddress, appId],
  )

  const getClient = useCallback(() => {
    const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
    algorand.setDefaultSigner(transactionSigner)
    return new RockPaperScissorsClient({ algorand, appId })
  }, [transactionSigner, appId])

  // --- DATA FETCHING ---
  const refreshData = useCallback(async () => {
    if (!appId || appId === 0n) return

    try {
      const client = getClient()
      const algorand = client.algorand

      // 1. MBR Calculation
      if (mbrs.create === 0) {
        try {
          const composer = client.newGroup()
          const simulatorSender = activeAddress ?? client.appAddress
          composer.getRequiredMbr({ args: { command: 'newGame' }, sender: simulatorSender })
          composer.getRequiredMbr({ args: { command: 'join' }, sender: simulatorSender })
          const result = await composer.simulate({ allowUnnamedResources: true })
          if (result.returns[0] !== undefined && result.returns[1] !== undefined) {
            setMbrs({ create: Number(result.returns[0]) / 1e6, join: Number(result.returns[1]) / 1e6 })
          }
        } catch (e) {
          console.warn('RPS MBR sim failed', e)
        }
      }

      // 2. Bulk Fetch
      const boxSessionsMap = await client.state.box.gameSessions.getMap()
      const boxPlayersMap = await client.state.box.sessionPlayers.getMap()
      const boxBalancesMap = await client.state.box.sessionBalances.getMap()
      const status = await algorand.client.algod.status().do()
      const currentRound = Number(status['lastRound'])

      const allSessions: RPSSession[] = []

      for (const [key, conf] of boxSessionsMap.entries()) {
        const id = Number(key)
        const players = boxPlayersMap.get(key)
        const balance = boxBalancesMap.get(key)

        const start = Number(conf.startAt)
        const endCommit = Number(conf.endCommitAt)
        const endReveal = Number(conf.endRevealAt)
        const fee = Number(conf.participation) / 1e6
        const totalPot = balance ? Number(balance) / 1e6 : 0

        const p1 = players?.p1 ? algosdk.encodeAddress(algosdk.decodeAddress(players.p1).publicKey) : ''
        const p2 = players?.p2 ? algosdk.encodeAddress(algosdk.decodeAddress(players.p2).publicKey) : ''

        const isP1Empty = p1 === 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'
        const isP2Empty = p2 === 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'

        let playersCount = 0
        if (!isP1Empty) playersCount++
        if (!isP2Empty) playersCount++

        // Usa utility per calcolare fase
        const phase = getPhase(currentRound, start, endCommit, endReveal)

        // Local Storage
        const myKey = getStorageKey(id)
        const localJson = myKey ? localStorage.getItem(myKey) : null
        let myMove: number | null = null
        let hasRevealed = false
        let claimResult = null

        if (localJson) {
          try {
            const parsed = JSON.parse(localJson)
            myMove = parsed.move
            hasRevealed = !!parsed.hasRevealed
            claimResult = parsed.claimResult || null
          } catch {}
        }

        const isPlayer1 = activeAddress === p1
        const isPlayer2 = activeAddress === p2
        const hasPlayed = isPlayer1 || isPlayer2

        // ✅ AGGIUNTO: Gestione timeout usando utility
        claimResult = handleTimeout(
          myKey,
          fee,
          hasPlayed,
          hasRevealed,
          claimResult,
          currentRound,
          endReveal
        )

        const canJoin = phase === 'COMMIT' && (isP1Empty || isP2Empty) && !hasPlayed && activeAddress !== undefined
        const canReveal = phase === 'REVEAL' && hasPlayed && !hasRevealed
        const canClaim = hasPlayed && !claimResult && (phase === 'ENDED' || currentRound > endReveal) && hasRevealed

        allSessions.push({
          id, phase, fee, totalPot, playersCount,
          player1: isP1Empty ? 'Waiting...' : p1,
          player2: isP2Empty ? 'Waiting...' : p2,
          canJoin, canReveal, canClaim, hasPlayed, hasRevealed, myMove, claimResult,
          rounds: { start, endCommit, endReveal, current: currentRound },
        })
      }

      const sorted = allSessions.sort((a, b) => b.id - a.id)
      setActiveSessions(sorted.filter((s) => s.phase !== 'ENDED'))
      setHistorySessions(sorted.filter((s) => s.phase === 'ENDED'))
      setMySessions(sorted.filter((s) => s.hasPlayed))

    } catch (e: any) {
      console.error('RPS Fetch error:', e)
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
      const participationAmount = AlgoAmount.Algos(fee)

      const mbrPayment = await algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.Algos(mbrs.create)
      })

      await client.send.createSession({
        args: {
          config: { startAt, endCommitAt, endRevealAt, participation: BigInt(participationAmount.microAlgos) },
          mbrPayment: { txn: mbrPayment, signer: transactionSigner }
        },
        sender: activeAddress,
        populateAppCallResources: true
      })

      showAlert('RPS Session created!', 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const joinSession = async (sessionId: number, move: number, fee: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect wallet')
      const client = getClient()
      const algorand = client.algorand

      // Usa utility per commit
      const { commitHash, salt } = await createCommit(move, 32)

      const mbrPayment = await algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.Algos(mbrs.join)
      })
      const betPayment = await algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.Algos(fee)
      })

      await client.send.joinSession({
        args: {
          sessionId: BigInt(sessionId),
          commit: commitHash,
          payment: { txn: betPayment, signer: transactionSigner },
          mbrPayment: { txn: mbrPayment, signer: transactionSigner }
        },
        sender: activeAddress,
        populateAppCallResources: true
      })

      const secretData = { move, salt: Array.from(salt), hasRevealed: false }
      const key = getStorageKey(sessionId)
      if (key) localStorage.setItem(key, JSON.stringify(secretData))

      notifyUpdate()
      showAlert('Joined Battle!', 'success')
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
      if (!stored) throw new Error('Local data lost.')
      const { move, salt } = JSON.parse(stored)
      const client = getClient()

      await client.send.revealMove({
        args: { sessionId: BigInt(sessionId), choice: BigInt(move), salt: new Uint8Array(salt) },
        sender: activeAddress,
        populateAppCallResources: true
      })

      const updateData = JSON.parse(stored)
      updateData.hasRevealed = true
      if (key) localStorage.setItem(key, JSON.stringify(updateData))

      showAlert('Move Revealed!', 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const claimWinnings = async (sessionId: number, entryFee: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect your wallet.')
      const client = getClient()

      const result = await client.send.claimWinnings({
        args: { sessionId: BigInt(sessionId) },
        sender: activeAddress,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(6000),
      })

      const wonAmount = Number(result.return) / 1e6 - entryFee
      const key = getStorageKey(sessionId)

      if (key) {
        const stored = localStorage.getItem(key)
        if (stored) {
          const data = JSON.parse(stored)
          data.claimResult = { amount: wonAmount, timestamp: Date.now() }
          localStorage.setItem(key, JSON.stringify(data))
          notifyUpdate()
        }
      }

      if (wonAmount >= 0) showAlert(`You won ${wonAmount} ALGO!`, 'success')

      refreshData()
    } catch (e: any) {
      const errorMsg = e.message || JSON.stringify(e)
      if (errorMsg.includes('You did not win') || errorMsg.includes('logic eval error')) {
        const key = getStorageKey(sessionId)
        if (key) {
          const stored = localStorage.getItem(key)
          if (stored) {
            const data = JSON.parse(stored)
            data.claimResult = { amount: -entryFee, timestamp: Date.now() }
            localStorage.setItem(key, JSON.stringify(data))
            notifyUpdate()
          }
        }
        showAlert('Better luck next time!', 'error')
        refreshData()
      } else {
        showAlert(e.message, 'error')
      }
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
