/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useWallet } from '@txnlab/use-wallet-react'
import { StagHuntClient } from '../contracts/StagHunt'
import { config } from '../config'
import { useAlert } from '../context/AlertContext'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { createCommit, getPhase, handleTimeout, notifyUpdate } from './gameUtils'
import algosdk, { TransactionSigner } from 'algosdk'
import { useTransactionToast } from '../context/TransactionToast'

/**
 * Represents the current phase of a Stag Hunt game session.
 */
export type StagHuntPhase = 'WAITING' | 'COMMIT' | 'REVEAL' | 'ENDED'

/**
 * Represents a Stag Hunt game session with all its state and metadata.
 */
export type StagHuntSession = {
  id: number
  phase: StagHuntPhase
  fee: number
  playersCount: number
  totalPot: number
  canJoin: boolean
  canReveal: boolean
  canClaim: boolean
  canResolve: boolean
  hasPlayed: boolean
  hasRevealed: boolean
  myChoice?: number | null // 0 = Hare, 1 = Stag
  claimResult?: { amount: number; timestamp: number; isTimeout?: boolean } | null
  gameStats: {
    stags: number
    hares: number
    resolved: boolean
    successful: boolean
    rewardPerStag: number
  }
  globalJackpot: number
  rounds: { start: number; endCommit: number; endReveal: number; current: number }
}

/**
 * Custom React hook for managing Stag Hunt game interactions.
 * 
 * Provides:
 * - Session state management (active, history, user's sessions)
 * - Game actions (create, join, reveal, resolve, claim)
 * - Real-time data synchronization with blockchain
 * - MBR (Minimum Balance Requirement) calculation
 * - Global jackpot tracking
 * - Local storage persistence for user choices
 */
export const useStagHunt = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const { showAlert } = useAlert()
  const { showToast} = useTransactionToast()
  const [loading, setLoading] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const [activeSessions, setActiveSessions] = useState<StagHuntSession[]>([])
  const [historySessions, setHistorySessions] = useState<StagHuntSession[]>([])
  const [mySessions, setMySessions] = useState<StagHuntSession[]>([])
  const [mbrs, setMbrs] = useState({ create: 0, join: 0 })
  const [globalJackpot, setGlobalJackpot] = useState(0)

  const appId = config.games.stagHunt.appId

  /**
   * Generates a storage key for persisting user's session data in localStorage.
   */
  const getStorageKey = useCallback(
    (sessionId: number) => activeAddress ? `stag_${appId}_${activeAddress}_${sessionId}` : null,
    [activeAddress, appId],
  )

  
  /**
   * Creates and configures a StagHuntClient instance.
  */
 const getClient = useCallback(() => {
   const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
   algorand.setDefaultSigner(transactionSigner)
   return new StagHuntClient({ algorand, appId })
  }, [transactionSigner, appId])
  
  /**
  * Creates and configures a RockPaperScissorsClient instance for the MBR simulation.
  */
 const getSimClient = useCallback(() => {
 const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
 return new StagHuntClient({ algorand, appId })
}, [appId])

  // --- DATA FETCHING ---
  
  /**
   * Fetches and processes all Stag Hunt session data from the blockchain.
   * 
   * This function:
   * 1. Calculates MBR requirements if not already known
   * 2. Fetches global jackpot amount
   * 3. Reads session configuration, statistics, and balances from contract boxes
   * 4. Computes current phase and user-specific permissions
   * 5. Handles timeout claims for unrevealed commitments
   * 6. Updates local state with categorized sessions
   */
  const refreshData = useCallback(async () => {
    if (!appId || appId === 0n) return

    try {
      const client = getSimClient()
      const algorand = client.algorand

      if (mbrs.create === 0 && activeAddress) {
        try {

          const simulationSender = activeAddress
          const composer = client.newGroup()
          composer.getRequiredMbr({ args: { command: 'newGame' }, sender: simulationSender })
          composer.getRequiredMbr({ args: { command: 'join' }, sender: simulationSender })
          const result = await composer.simulate({ allowUnnamedResources: true, skipSignatures: true })
          if (result.returns[0] !== undefined && result.returns[1] !== undefined) {
            setMbrs({ create: Number(result.returns[0]) / 1e6, join: Number(result.returns[1]) / 1e6 })
          }
        } catch (e) {
          console.warn('StagHunt MBR sim failed', e)
        }
      }

      // Get Global Jackpot
      try {
        const jackpot = await client.state.global.globalJackpot()
        setGlobalJackpot(jackpot ? Number(jackpot) / 1e6 : 0)
      } catch (e) {
        console.warn('Failed to fetch global jackpot', e)
      }

      // Bulk Fetch
      const boxSessionsMap = await client.state.box.gameSessions.getMap()
      const boxStatsMap = await client.state.box.stats.getMap()
      const boxBalancesMap = await client.state.box.sessionBalances.getMap()
      const status = await algorand.client.algod.status().do()
      const currentRound = Number(status['lastRound'])

      const allSessions: StagHuntSession[] = []

      for (const [key, conf] of boxSessionsMap.entries()) {
        const id = Number(key)
        const stats = boxStatsMap.get(key)
        const balance = boxBalancesMap.get(key)

        const start = Number(conf.startAt)
        const endCommit = Number(conf.endCommitAt)
        const endReveal = Number(conf.endRevealAt)
        const fee = Number(conf.participation) / 1e6 
        const totalPot = balance ? Number(balance) / 1e6 : 0

        // Extract game statistics
        const stags = stats ? Number(stats.stags) : 0
        const hares = stats ? Number(stats.hares) : 0
        const resolved = stats ? stats.resolved : false
        const successful = stats ? stats.successful : false
        const rewardPerStag = stats ? Number(stats.rewardPerStag) / 1e6 : 0

        // Calculate player count based on revealed choices or pot size
        const revealedCount = stags + hares
        let playersCount = revealedCount
        if (currentRound <= endCommit && fee > 0) {
          playersCount = Math.floor(totalPot / fee)
        }

        const phase = getPhase(currentRound, start, endCommit, endReveal)

        // Check localStorage for user's participation data
        const myKey = getStorageKey(id)
        const localJson = myKey ? localStorage.getItem(myKey) : null
        let myChoice: number | null = null
        let hasRevealed = false
        let claimResult = null

        if (localJson) {
          try {
            const parsed = JSON.parse(localJson)
            myChoice = parsed.choice
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

        const canResolve = (phase === 'ENDED' || currentRound > endReveal) && !resolved

        const canClaim = resolved && hasRevealed && !claimResult

        allSessions.push({
          id,
          phase,
          fee,
          playersCount,
          totalPot,
          canJoin,
          canReveal,
          canClaim,
          canResolve,
          hasPlayed,
          hasRevealed,
          myChoice,
          claimResult,
          gameStats: { stags, hares, resolved, successful, rewardPerStag },
          globalJackpot,
          rounds: { start, endCommit, endReveal, current: currentRound },
        })
      }

      const sorted = allSessions.sort((a, b) => b.id - a.id)
      setActiveSessions(sorted.filter((s) => s.phase !== 'ENDED'))
      setHistorySessions(sorted.filter((s) => s.phase === 'ENDED'))
      setMySessions(sorted.filter((s) => s.hasPlayed))
    } catch (e: any) {
      console.error('StagHunt Fetch error:', e)
    } finally {
      setIsInitializing(false)
    }
  }, [appId, activeAddress, getClient, mbrs.create, getStorageKey])

  // --- ACTIONS ---

  /**
   * Creates a new Stag Hunt game session.
   */
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
        amount: AlgoAmount.Algos(mbrs.create),
      })

      const result = await client.send.createSession({
        args: {
          config: { startAt, endCommitAt, endRevealAt, participation: BigInt(participationAmount.microAlgos) },
          mbrPayment: { txn: mbrPayment, signer: transactionSigner },
        },
        sender: activeAddress,
      })

      showAlert('StagHunt Session created!', 'success')
      showToast({
        agentName: activeAddress.substring(0,6),
        txId: result.transaction.txID(),
        type: 'CREATE'
        })
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Joins an existing Stag Hunt session by committing to a choice.
   */
  const joinSession = async (sessionId: number, choice: number, fee: number) => {
    setLoading(true)
    try {
      // Input validation: choice must be 0 (Hare) or 1 (Stag)
      if (choice !== 0 && choice !== 1) {
        throw new Error('Invalid choice: must be 0 (Hare) or 1 (Stag)')
      }

      if (!activeAddress) throw new Error('Connect wallet')
      const client = getClient()
      const algorand = client.algorand

      const { commitHash, salt } = await createCommit(choice, 32)

      const payment = await algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.Algos(fee),
      })

      const result = await client.send.joinSession({
        args: { sessionId: BigInt(sessionId), commit: commitHash, payment: { txn: payment, signer: transactionSigner } },
        sender: activeAddress,
      })

      const secretData = { choice, salt: Array.from(salt), hasRevealed: false }
      const key = getStorageKey(sessionId)
      if (key) localStorage.setItem(key, JSON.stringify(secretData))

      notifyUpdate()
      showAlert('Choice committed!', 'success')
      showToast({
        agentName: activeAddress.substring(0,6),
        txId: result.transaction.txID(),
        type: 'COMMIT'
        })
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Reveals a previously committed choice.
   */
  const revealMove = async (sessionId: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect wallet')
      const key = getStorageKey(sessionId)
      const stored = key ? localStorage.getItem(key) : null
      if (!stored) throw new Error('Local data lost.')
      
      const { choice, salt } = JSON.parse(stored)
      const client = getClient()

      const result = await client.send.revealMove({
        args: { sessionId: BigInt(sessionId), choice: BigInt(choice), salt: new Uint8Array(salt) },
        sender: activeAddress,
      })

      const updateData = JSON.parse(stored)
      updateData.hasRevealed = true
      if (key) localStorage.setItem(key, JSON.stringify(updateData))

      showAlert('Choice Revealed!', 'success')
      showToast({
        agentName: activeAddress.substring(0,6),
        txId: result.transaction.txID(),
        type: 'REVEAL'
        })
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Resolves a completed session (admin action).
   * 
   * Determines game outcome and distributes winnings/refunds.
   */
  const resolveSession = async (sessionId: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect wallet')
      const client = getClient()

      const result = await client.send.resolveSession({
        args: { sessionId: BigInt(sessionId) },
        sender: activeAddress,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(4000),
      })

      showAlert('Session Resolved!', 'success')
      showToast({
        agentName: activeAddress.substring(0,6),
        txId: result.transaction.txID(),
        type: 'EXECUTE'
        })
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Claims winnings from a resolved session.
   * 
   * Auto-attempts to resolve session if not already resolved.
   * Calculates net profit and updates local claim result.
   */
  const claimWinnings = async (sessionId: number, fee: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect wallet')
      const client = getClient()
      
      const session = [...activeSessions, ...historySessions].find(s => s.id === sessionId)
      if (session && !session.gameStats.resolved) {
        try {
          await client.send.resolveSession({
            args: { sessionId: BigInt(sessionId) },
            sender: activeAddress,
          })
          showAlert('Session auto-resolved before claim', 'info')
        } catch (resolveError: any) {
          console.warn('Auto-resolve failed:', resolveError)
        }
      }

      const result = await client.send.claimWinnings({
        args: { sessionId: BigInt(sessionId) },
        sender: activeAddress,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(6000),
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

      if (grossPayout > 0) showAlert(`You won ${grossPayout} A (Net: ${netProfit})!`, 'success')
      else showAlert('Refund claimed.', 'info')
      showToast({
        agentName: activeAddress.substring(0,6),
        txId: result.transaction.txID(),
        type: 'CLAIM'
        })
      refreshData()
    } catch (e: any) {
      const errorMsg = e.message || JSON.stringify(e)
      
      // Handle "did not win" errors by recording loss in localStorage
      if (errorMsg.includes('You did not win') || errorMsg.includes('logic eval error')) {
        const key = getStorageKey(sessionId)
        if (key) {
          const stored = localStorage.getItem(key)
          if (stored) {
            const data = JSON.parse(stored)
            data.claimResult = { amount: -fee, timestamp: Date.now() }
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

  /**
   * Effect hook for initial data fetch and periodic refresh.
   * 
   * Fetches data immediately on mount and every 5 seconds thereafter.
   * Cleans up interval on unmount.
   */
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
    globalJackpot,
    loading,
    isInitializing,
    createSession,
    joinSession,
    revealMove,
    resolveSession, 
    claimWinnings,
  }
}