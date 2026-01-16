/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { GuessGameClient } from '../contracts/GuessGame'
import { config } from '../config'
import { useAlert } from '../context/AlertContext'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'

// Helper per hash SHA256 browser-safe
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer)
  return new Uint8Array(hashBuffer)
}

export type GameSession = {
  id: number
  phase: 'WAITING' | 'COMMIT' | 'REVEAL' | 'ENDED'
  fee: number
  players: number
  totalPot: number
  canReveal: boolean
  hasPlayed: boolean
  rounds: { start: number; endCommit: number; endReveal: number; current: number }
}

export const useGuessGame = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const { showAlert } = useAlert()

  // Loading stati:
  // - loading: per le azioni (transazioni in corso)
  // - isInitializing: per il caricamento iniziale dei dati (evita il flash "0 sessioni")
  const [loading, setLoading] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)

  const [activeSessions, setActiveSessions] = useState<GameSession[]>([])
  const [historySessions, setHistorySessions] = useState<GameSession[]>([])

  const [mbrs, setMbrs] = useState({ create: 0, join: 0 })

  const appId = config.games.guessGame.appId

  // Creazione Client
  const getClient = useCallback(() => {
    const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
    algorand.setDefaultSigner(transactionSigner)
    return new GuessGameClient({ algorand, appId })
  }, [transactionSigner, appId])

  // --- FETCH DATA ---
  const refreshData = useCallback(async () => {
    if (!appId || appId === 0n) return

    try {
      const client = getClient()
      const algorand = client.algorand

      // 1. Fetch MBRs (Simulazione)
      // Se non abbiamo ancora i costi MBR, proviamo a leggerli.
      // Usiamo activeAddress se c'è, altrimenti l'appAddress per simulare la chiamata read-only.
      if (mbrs.create === 0) {
         try {
             const composer = client.newGroup()
             const simulatorSender = activeAddress ?? client.appAddress

             // Nota: il comando è 'join', non 'joinGame'
             composer.getRequiredMbr({ args: { command: 'newGame' }, sender: simulatorSender })
             composer.getRequiredMbr({ args: { command: 'join' }, sender: simulatorSender })

             const result = await composer.simulate({ allowUnnamedResources: true })

             const realCreateMBR = Number(result.returns[0]) / 1e6
             const realJoinMBR = Number(result.returns[1]) / 1e6

             console.log("✅ MBR Aggiornati:", { create: realCreateMBR, join: realJoinMBR })

             setMbrs({ create: realCreateMBR, join: realJoinMBR })
         } catch (e) {
             console.warn("⚠️ Simulazione MBR non riuscita (forse nodo non raggiungibile)", e)
         }
      }

      // 2. Fetch Sessioni (Box Storage)
      const boxSessions = await client.state.box.gameSessions.getMap()
      const boxStats = await client.state.box.stats.getMap()

      const status = await algorand.client.algod.status().do()
      const currentRound = Number(status['lastRound'])

      const allSessions: GameSession[] = []

      for (const [key, conf] of boxSessions.entries()) {
        const id = Number(key)
        const stats = boxStats.get(key)

        const start = Number(conf.startAt)
        const endCommit = Number(conf.endCommitAt)
        const endReveal = Number(conf.endRevealAt)
        const fee = Number(conf.participation) / 1e6
        const count = stats ? Number(stats.count) : 0
        const totalPot = fee * count

        let phase: GameSession['phase'] = 'ENDED'
        if (currentRound < start) phase = 'WAITING'
        else if (currentRound <= endCommit) phase = 'COMMIT'
        else if (currentRound <= endReveal) phase = 'REVEAL'

        // Controlliamo local storage
        const localData = localStorage.getItem(`guess_${appId}_${id}`)
        const canReveal = phase === 'REVEAL' && !!localData
        const hasPlayed = !!localData

        allSessions.push({
          id, phase, fee, players: count, totalPot, canReveal, hasPlayed,
          rounds: { start, endCommit, endReveal, current: currentRound }
        })
      }

      const active = allSessions.filter(s => s.phase !== 'ENDED').sort((a, b) => b.id - a.id)
      const history = allSessions.filter(s => s.phase === 'ENDED').sort((a, b) => b.id - a.id)

      setActiveSessions(active)
      setHistorySessions(history)

    } catch (e: any) {
      console.error("Fetch error:", e)
    } finally {
      // Quando abbiamo finito il primo fetch, rimuoviamo lo stato di inizializzazione
      setIsInitializing(false)
    }
  }, [appId, activeAddress, getClient, mbrs.create])

  // --- AZIONI ---

  const createSession = async (fee: number, startDelay: number, commitLen: number, revealLen: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error("Connetti il wallet.")
      if (mbrs.create === 0) throw new Error("Attendi il caricamento MBR.")

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
        amount: AlgoAmount.MicroAlgo(algosdk.algosToMicroalgos(mbrs.create))
      })

      await client.send.createSession({
        args: {
          config: { startAt, endCommitAt, endRevealAt, participation: BigInt(participationFee) },
          mbrPayment: { txn: payment, signer: transactionSigner }
        },
        sender: activeAddress
      })

      showAlert(`Sessione creata con successo!`, 'success')
      refreshData()
    } catch (e: any) {
      console.error(e)
      showAlert(`Errore Creazione: ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const joinSession = async (sessionId: number, guess: number, participationFee: number) => {
    setLoading(true)
    try {
      if(!activeAddress) throw new Error("Connetti il wallet.")

      // Removed check on mbrs.join here as it's not paid by user

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
        amount: AlgoAmount.MicroAlgo(feeMicro)
      })

      await client.send.joinSession({
        args: {
            sessionId: BigInt(sessionId),
            commit: commitHash,
            payment: { txn: payment, signer: transactionSigner }
        },
        sender: activeAddress
      })

      const secretData = { guess, salt: Array.from(salt) }
      localStorage.setItem(`guess_${appId}_${sessionId}`, JSON.stringify(secretData))

      showAlert('Puntata registrata! Salva i dati per il reveal.', 'success')
      refreshData()
    } catch (e: any) {
      console.error(e)
      showAlert(`Errore Join: ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const revealMove = async (sessionId: number) => {
    setLoading(true)
    try {
      if(!activeAddress) throw new Error("Connetti il wallet.")
      const stored = localStorage.getItem(`guess_${appId}_${sessionId}`)
      if (!stored) throw new Error("Dati locali persi.")

      const { guess, salt } = JSON.parse(stored)
      const client = getClient()

      await client.send.revealMove({
        args: {
            sessionId: BigInt(sessionId),
            choice: BigInt(guess),
            salt: new Uint8Array(salt)
        },
        sender: activeAddress
      })

      showAlert('Numero rivelato!', 'success')
      refreshData()
    } catch (e: any) {
      console.error(e)
      showAlert(`Errore Reveal: ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Refresh automatico + Cambio Wallet
  useEffect(() => {
    // Appena monta o cambia wallet, ricarica
    refreshData()
    const interval = setInterval(refreshData, 5000)
    return () => clearInterval(interval)
  }, [refreshData, activeAddress])

  return { activeSessions, historySessions, mbrs, loading, isInitializing, createSession, joinSession, revealMove }
}
