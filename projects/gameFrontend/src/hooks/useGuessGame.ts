/* eslint-disable no-empty */
/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { GuessGameClient } from '../contracts/GuessGame'
import { config } from '../config'
import { useAlert } from '../context/AlertContext'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer)
  return new Uint8Array(hashBuffer)
}

export type GameSession = {
  id: number
  phase: 'WAITING' | 'COMMIT' | 'REVEAL' | 'ENDED'
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

  // Helper per notificare aggiornamenti stats
  const notifyStorageUpdate = () => {
    window.dispatchEvent(new Event('game-storage-update'))
  }

  // --- FETCH DATA ---
  const refreshData = useCallback(async () => {
    if (!appId || appId === 0n) return

    try {
      const client = getClient()
      const algorand = client.algorand

      // 1. MBR
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
          console.warn('MBR warning', e)
        }
      }

      // 2. Fetch Massivo
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

        if (stats && Number(stats.count) > 0) {
          playersCount = Number(stats.count)
        } else if (fee > 0) {
          playersCount = Math.floor(totalPot / fee)
        }

        const sum = stats ? Number(stats.sum) : 0

        let phase: GameSession['phase'] = 'ENDED'
        if (currentRound < start) phase = 'WAITING'
        else if (currentRound <= endCommit) phase = 'COMMIT'
        else if (currentRound <= endReveal) phase = 'REVEAL'

        const myKey = activeAddress ? `guess_${appId}_${activeAddress}_${id}` : null
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
            /* ignore */
          }
        }

        const hasPlayed = !!localJson

        // --- GESTIONE TIMEOUT SCONFITTA ---
        if (hasPlayed && !hasRevealed && !claimResult && currentRound > endReveal) {
          claimResult = {
            amount: -fee,
            timestamp: Date.now(),
            isTimeout: true,
          }
          if (myKey && localJson) {
            try {
              const updateData = JSON.parse(localJson)
              updateData.claimResult = claimResult
              localStorage.setItem(myKey, JSON.stringify(updateData))
              notifyStorageUpdate() // Notifica Navbar
            } catch {}
          }
        }

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
  }, [appId, activeAddress, getClient, mbrs.create])

  // --- ACTIONS ---

  const createSession = async (fee: number, startDelay: number, commitLen: number, revealLen: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connetti il wallet.')
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

      showAlert(`Sessione creata!`, 'success')
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
      if (!activeAddress) throw new Error('Connetti il wallet.')
      const client = getClient()
      const salt = new Uint8Array(16)
      crypto.getRandomValues(salt)
      const guessBytes = algosdk.encodeUint64(guess)
      const buffer = new Uint8Array(guessBytes.length + salt.length)
      buffer.set(guessBytes)
      buffer.set(salt, guessBytes.length)
      const commitHash = await sha256(buffer)
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

      showAlert('Puntata registrata!', 'success')
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
      if (!activeAddress) throw new Error('Connetti il wallet.')
      const key = getStorageKey(sessionId)
      const stored = key ? localStorage.getItem(key) : null
      if (!stored) throw new Error('Dati locali persi.')

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

      showAlert('Reveal effettuato!', 'success')
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
      if (!activeAddress) throw new Error('Connetti il wallet.')
      const client = getClient()

      const result = await client.send.claimWinnings({
        args: { sessionId: BigInt(sessionId) },
        sender: activeAddress,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(6000),
      })

      const wonAmount = Number(result.return) / 1e6 - entryFee
      saveClaimResult(sessionId, wonAmount)

      if (wonAmount >= 0) showAlert(`Hai vinto ${wonAmount} ALGO!`, 'success')
      else showAlert('Non hai vinto, ma hai recuperato lo storage.', 'info')

      refreshData()
    } catch (e: any) {
      const errorMsg = e.message || JSON.stringify(e)
      if (errorMsg.includes('You did not win') || errorMsg.includes('logic eval error')) {
        saveClaimResult(sessionId, -entryFee)
        showAlert('Peccato! Non hai vinto.', 'info')
        refreshData()
      } else {
        showAlert(e.message, 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  const saveClaimResult = (sessionId: number, amount: number) => {
    const key = getStorageKey(sessionId)
    if (key) {
      const stored = localStorage.getItem(key)
      if (stored) {
        const data = JSON.parse(stored)
        data.claimResult = { amount: amount, timestamp: Date.now() }
        localStorage.setItem(key, JSON.stringify(data))
        notifyStorageUpdate() // NOTIFICA LA NAVBAR
      }
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
