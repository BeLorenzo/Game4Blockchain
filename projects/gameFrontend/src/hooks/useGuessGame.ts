/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { GuessGameClient } from '../contracts/GuessGame'
import { config } from '../config'
import { useAlert } from '../context/AlertContext'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { createCommit, getPhase, handleTimeout, notifyUpdate } from './gameUtils'

export type GamePhase = 'WAITING' | 'COMMIT' | 'REVEAL' | 'ENDED'

export type GameSession = {
  id: number
  phase: GamePhase
  fee: number
  playersCount: number
  totalPot: number
  canReveal: boolean
  canClaim: boolean
  hasPlayed: boolean
  hasRevealed: boolean
  claimResult?: { amount: number; timestamp: number; isTimeout?: boolean } | null
  myGuess?: number | null
  gameStats: {
    sum: number
    count: number
    average: number
    target: number
  }
  rounds: { start: number; endCommit: number; endReveal: number; current: number }
}

export const useGuessGame = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const { showAlert } = useAlert()

  const [loading, setLoading] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const [activeSessions, setActiveSessions] = useState<GameSession[]>([])
  const [historySessions, setHistorySessions] = useState<GameSession[]>([])
  const [mySessions, setMySessions] = useState<GameSession[]>([])
  const [mbrs, setMbrs] = useState({ create: 0, join: 0 })

  const appId = config.games.guessGame.appId

  const getStorageKey = useCallback(
    (sessionId: number) => {
      if (!activeAddress) return null
      return `guess_${appId}_${activeAddress}_${sessionId}`
    },
    [activeAddress, appId],
  )

  const getClient = useCallback(() => {
    const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
    algorand.setDefaultSigner(transactionSigner)
    return new GuessGameClient({ algorand, appId })
  }, [transactionSigner, appId])

  // --- DATA FETCHING ---
  const refreshData = useCallback(async () => {
    if (!appId || appId === 0n) return

    try {
      const client = getClient()
      const algorand = client.algorand

      // 1. Calculate MBR only once
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
          console.warn('MBR simulation failed', e)
        }
      }

      // 2. Bulk Fetch from Box Storage
      const boxSessions = await client.state.box.gameSessions.getMap()
      const boxStats = await client.state.box.stats.getMap()
      const boxBalances = await client.state.box.sessionBalances.getMap()

      const status = await algorand.client.algod.status().do()
      const currentRound = Number(status['lastRound'])

      const allSessions: GameSession[] = []

      for (const [key, conf] of boxSessions.entries()) {
        const id = Number(key)
        const stats = boxStats.get(key)
        const balance = boxBalances.get(key)

        const start = Number(conf.startAt)
        const endCommit = Number(conf.endCommitAt)
        const endReveal = Number(conf.endRevealAt)
        const fee = Number(conf.participation) / 1e6
        const totalPot = balance ? Number(balance) / 1e6 : 0

        let playersCount = 0
        if (stats && Number(stats.count) > 0) playersCount = Number(stats.count)
        else if (fee > 0) playersCount = Math.floor(totalPot / fee)

        const sum = stats ? Number(stats.sum) : 0

        // Usa utility per calcolare fase
        const phase = getPhase(currentRound, start, endCommit, endReveal)

        // Local Storage State
        const myKey = getStorageKey(id)
        const localJson = myKey ? localStorage.getItem(myKey) : null
        let myGuess: number | null = null
        let hasRevealed = false
        let claimResult = null

        if (localJson) {
          try {
            const parsed = JSON.parse(localJson)
            myGuess = Number(parsed.guess)
            hasRevealed = !!parsed.hasRevealed
            claimResult = parsed.claimResult || null
          } catch {
            /* parse error */
          }
        }

        const hasPlayed = !!localJson

        // Gestione timeout usando utility
        claimResult = handleTimeout(
          myKey,
          fee,
          hasPlayed,
          hasRevealed,
          claimResult,
          currentRound,
          endReveal
        )

        const canReveal = phase === 'REVEAL' && hasPlayed && !hasRevealed
        const canClaim = (phase === 'ENDED' || currentRound > endReveal) && hasRevealed && !claimResult

        let average = 0
        let target = 0
        if (playersCount > 0 && phase !== 'COMMIT' && phase !== 'WAITING') {
          average = sum / playersCount
          target = (average * 2) / 3
        }

        allSessions.push({
          id,
          phase,
          fee,
          playersCount,
          totalPot,
          canReveal,
          canClaim,
          hasPlayed,
          hasRevealed,
          claimResult,
          myGuess,
          gameStats: { sum, count: playersCount, average, target },
          rounds: { start, endCommit, endReveal, current: currentRound },
        })
      }

      const sorted = allSessions.sort((a, b) => b.id - a.id)
      setActiveSessions(sorted.filter((s) => s.phase !== 'ENDED'))
      setHistorySessions(sorted.filter((s) => s.phase === 'ENDED'))
      setMySessions(sorted.filter((s) => s.hasPlayed))
    } catch (e: any) {
      console.error('Fetch error:', e)
    } finally {
      setIsInitializing(false)
    }
  }, [appId, activeAddress, getClient, mbrs.create, getStorageKey])

  // --- ACTIONS ---

  const createSession = async (fee: number, startDelay: number, commitLen: number, revealLen: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect your wallet.')
      const client = getClient()
      const algorand = client.algorand
      const status = await algorand.client.algod.status().do()
      const currentRound = BigInt(status['lastRound'])

      const startAt = currentRound + BigInt(startDelay)
      const endCommitAt = startAt + BigInt(commitLen)
      const endRevealAt = endCommitAt + BigInt(revealLen)
      const participationFee = algosdk.algosToMicroalgos(fee)

      const payment = await algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgo(algosdk.algosToMicroalgos(mbrs.create)),
      })

      await client.send.createSession({
        args: {
          config: { startAt, endCommitAt, endRevealAt, participation: BigInt(participationFee) },
          mbrPayment: { txn: payment, signer: transactionSigner },
        },
        sender: activeAddress,
      })

      showAlert('Game session created successfully!', 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const joinSession = async (sessionId: number, guess: number, participationFee: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect your wallet.')
      const client = getClient()

      // Usa utility per commit
      const { commitHash, salt } = await createCommit(guess, 16)
      const feeMicro = Math.round(participationFee * 1e6)

      const payment = await client.algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgo(feeMicro),
      })

      await client.send.joinSession({
        args: {
          sessionId: BigInt(sessionId),
          commit: commitHash,
          payment: { txn: payment, signer: transactionSigner },
        },
        sender: activeAddress,
      })

      const secretData = { guess, salt: Array.from(salt), hasRevealed: false }
      const key = getStorageKey(sessionId)
      if (key) localStorage.setItem(key, JSON.stringify(secretData))

      showAlert('Guess committed successfully!', 'success')
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
      if (!activeAddress) throw new Error('Connect your wallet.')
      const key = getStorageKey(sessionId)
      const stored = key ? localStorage.getItem(key) : null
      if (!stored) throw new Error('Local game data lost.')

      const data = JSON.parse(stored)
      const client = getClient()

      await client.send.revealMove({
        args: {
          sessionId: BigInt(sessionId),
          choice: BigInt(data.guess),
          salt: new Uint8Array(data.salt),
        },
        sender: activeAddress,
      })

      data.hasRevealed = true
      if (key) localStorage.setItem(key, JSON.stringify(data))

      showAlert('Move revealed successfully!', 'success')
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
    const interval = setInterval(refreshData, 5000)
    return () => clearInterval(interval)
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
    claimWinnings,
  }
}
