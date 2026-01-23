/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { RockPaperScissorsClient } from '../contracts/RockPaperScissors'
import { config } from '../config'
import { useAlert } from '../context/AlertContext'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'

// Utility: SHA-256 for Commit/Reveal
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer)
  return new Uint8Array(hashBuffer)
}

export type RPSPhase = 'WAITING' | 'COMMIT' | 'REVEAL' | 'ENDED'

export type RPSSession = {
  id: number
  phase: RPSPhase
  fee: number
  totalPot: number
  player1: string
  player2: string
  canJoin: boolean
  canReveal: boolean
  canClaim: boolean
  hasPlayed: boolean
  hasRevealed: boolean
  myMove?: number | null // 0=Rock, 1=Paper, 2=Scissors
  rounds: { start: number; endCommit: number; endReveal: number; current: number }
}

export const useRPS = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const { showAlert } = useAlert()

  const [loading, setLoading] = useState(false)
  const [activeSessions, setActiveSessions] = useState<RPSSession[]>([])
  const [historySessions, setHistorySessions] = useState<RPSSession[]>([])
  // Costi MBR (Minimum Balance Requirement) calcolati dinamicamente
  const [mbrs, setMbrs] = useState({ create: 0, join: 0 })

  const appId = config.games.rps.appId

  // Genera chiave univoca per salvare il segreto nel LocalStorage
  const getStorageKey = useCallback(
    (sessionId: number) => {
      if (!activeAddress) return null
      return `rps_${appId}_${activeAddress}_${sessionId}`
    },
    [activeAddress, appId],
  )

  const getClient = useCallback(() => {
    const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
    algorand.setDefaultSigner(transactionSigner)
    return new RockPaperScissorsClient({ algorand, appId })
  }, [transactionSigner, appId])

  // --- 1. DATA FETCHING & MBR SIMULATION ---
  const refreshData = useCallback(async () => {
    if (!appId || appId === 0n) return

    try {
      const client = getClient()
      const algorand = client.algorand

      // A. Simula i costi MBR (solo se non li abbiamo già)
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
          console.warn('RPS MBR simulation failed (wallet might be disconnected)', e)
        }
      }

      // B. Scarica tutto lo stato dai Box
      const boxSessions = await client.state.box.gameSessions.getMap()
      const boxPlayers = await client.state.box.sessionPlayers.getMap()
      const boxBalances = await client.state.box.sessionBalances.getMap()
      const boxFinished = await client.state.box.gameFinished.getMap()

      const status = await algorand.client.algod.status().do()
      const currentRound = Number(status['lastRound'])

      const allSessions: RPSSession[] = []

      // C. Costruisci la lista delle sessioni
      for (const [key, conf] of boxSessions.entries()) {
        const id = Number(key)
        const players = boxPlayers.get(key)
        const balance = boxBalances.get(key)
        const isFinished = boxFinished.get(key) === 1n

        const start = Number(conf.startAt)
        const endCommit = Number(conf.endCommitAt)
        const endReveal = Number(conf.endRevealAt)
        const fee = Number(conf.participation) / 1e6
        const totalPot = balance ? Number(balance) / 1e6 : 0

        // Decodifica indirizzi giocatori
        const p1 = players?.p1 ? algosdk.encodeAddress(algosdk.decodeAddress(players.p1).publicKey) : ''
        const p2 = players?.p2 ? algosdk.encodeAddress(algosdk.decodeAddress(players.p2).publicKey) : ''

        // Zero Address Check (Indica slot libero)
        const zeroAddr = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'
        const isP1Empty = p1 === zeroAddr
        const isP2Empty = p2 === zeroAddr

        // Determina Fase
        let phase: RPSPhase = 'ENDED'
        if (isFinished) phase = 'ENDED'
        else if (currentRound < start) phase = 'WAITING'
        else if (currentRound <= endCommit) phase = 'COMMIT'
        else if (currentRound <= endReveal) phase = 'REVEAL'
        else phase = 'ENDED' // Timeout

        // Recupera stato locale (Mossa segreta)
        const myKey = getStorageKey(id)
        const localJson = myKey ? localStorage.getItem(myKey) : null
        let myMove: number | null = null
        let hasRevealed = false

        if (localJson) {
          const parsed = JSON.parse(localJson)
          myMove = parsed.move
          hasRevealed = !!parsed.hasRevealed
        }

        const isPlayer1 = activeAddress === p1
        const isPlayer2 = activeAddress === p2
        const hasPlayed = isPlayer1 || isPlayer2

        // LOGICA PER I BOTTONI
        // Puoi unirti se siamo in fase COMMIT, c'è uno slot libero, e non sei già dentro
        const canJoin = phase === 'COMMIT' && (isP1Empty || isP2Empty) && !hasPlayed && activeAddress !== undefined

        // Puoi rivelare se sei un giocatore, siamo in REVEAL, e non hai ancora fatto
        const canReveal = phase === 'REVEAL' && hasPlayed && !hasRevealed

        // Puoi reclamare (timeout) se il tempo è scaduto e la partita non è finita ufficialmente
        const canClaim = currentRound > endReveal && !isFinished && hasPlayed

        allSessions.push({
          id,
          phase,
          fee,
          totalPot,
          player1: isP1Empty ? 'Waiting...' : p1,
          player2: isP2Empty ? 'Waiting...' : p2,
          canJoin,
          canReveal,
          canClaim,
          hasPlayed,
          hasRevealed,
          myMove,
          rounds: { start, endCommit, endReveal, current: currentRound },
        })
      }

      const sorted = allSessions.sort((a, b) => b.id - a.id)
      setActiveSessions(sorted.filter((s) => s.phase !== 'ENDED'))
      setHistorySessions(sorted.filter((s) => s.phase === 'ENDED'))

    } catch (e: any) {
      console.error('RPS Fetch error:', e)
    }
  }, [appId, activeAddress, getClient, mbrs.create, getStorageKey])


  // --- 2. ACTION: CREATE SESSION (Config Only) ---
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

      // Pagamento MBR per creare la sessione
      const mbrPaymentCreate = await algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.Algos(mbrs.create),
      })

      await client.send.createSession({
        args: {
          config: {
              startAt,
              endCommitAt,
              endRevealAt,
              participation: BigInt(participationAmount.microAlgos)
          },
          mbrPayment: { txn: mbrPaymentCreate, signer: transactionSigner }
        },
        sender: activeAddress, // Sender obbligatorio
        populateAppCallResources: true
      })

      showAlert('Session initialized! Now you can join.', 'success')
      refreshData()
    } catch (e: any) {
      console.error(e)
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // --- 3. ACTION: JOIN SESSION (Commit Move) ---
  const joinSession = async (sessionId: number, betAmount: number, move: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect wallet')
      const client = getClient()
      const algorand = client.algorand

      // 1. Prepara il Commit (Hash di Mossa + Salt)
      const salt = new Uint8Array(32)
      crypto.getRandomValues(salt)
      const moveBytes = algosdk.encodeUint64(move)
      const buffer = new Uint8Array(moveBytes.length + salt.length)
      buffer.set(moveBytes)
      buffer.set(salt, moveBytes.length)
      const commitHash = await sha256(buffer)

      // 2. Pagamenti (MBR Player + Puntata)
      const mbrPaymentJoin = await algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.Algos(mbrs.join),
      })

      const betPayment = await algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.Algos(betAmount),
      })

      // 3. Invia Transazione
      await client.send.joinSession({
        args: {
            sessionId: BigInt(sessionId),
            commit: commitHash,
            payment: { txn: betPayment, signer: transactionSigner },
            mbrPayment: { txn: mbrPaymentJoin, signer: transactionSigner }
        },
        sender: activeAddress, // Sender obbligatorio
        populateAppCallResources: true
      })

      // 4. Salva il segreto nel LocalStorage (CRUCIALE per il Reveal)
      const secretData = { move, salt: Array.from(salt), hasRevealed: false }
      const key = getStorageKey(sessionId)
      if (key) localStorage.setItem(key, JSON.stringify(secretData))

      showAlert('Joined successfully! Don\'t lose this browser session.', 'success')
      refreshData()
    } catch (e: any) {
      console.error(e)
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // --- 4. ACTION: REVEAL MOVE ---
  const revealMove = async (sessionId: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect wallet')

      // Recupera segreto
      const key = getStorageKey(sessionId)
      const stored = key ? localStorage.getItem(key) : null
      if (!stored) throw new Error('Secret not found on this device! Cannot reveal.')

      const { move, salt } = JSON.parse(stored)
      const client = getClient()

      await client.send.revealMove({
        args: {
            sessionId: BigInt(sessionId),
            choice: BigInt(move),
            salt: new Uint8Array(salt)
        },
        sender: activeAddress, // Sender obbligatorio
        populateAppCallResources: true
      })

      // Aggiorna flag locale
      const updateData = JSON.parse(stored)
      updateData.hasRevealed = true
      if (key) localStorage.setItem(key, JSON.stringify(updateData))

      showAlert('Move revealed!', 'success')
      refreshData()
    } catch (e: any) {
      console.error(e)
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // --- 5. ACTION: CLAIM TIMEOUT (Opzionale ma utile) ---
  const claimTimeout = async (sessionId: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect wallet')
      const client = getClient()

      await client.send.claimTimeoutVictory({
        args: { sessionId: BigInt(sessionId) },
        sender: activeAddress,
        populateAppCallResources: true
      })

      showAlert('Timeout claimed!', 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Polling automatico
  useEffect(() => {
    refreshData()
    const interval = setInterval(refreshData, 5000)
    return () => clearInterval(interval)
  }, [refreshData, activeAddress])

  return {
    loading,
    activeSessions,
    historySessions,
    createSession,
    joinSession,
    revealMove,
    claimTimeout,
    mbrs
  }
}
