/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { PirateGameClient } from '../contracts/PirateGame'
import { config } from '../config'
import { useAlert } from '../context/AlertContext'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { createCommit, notifyUpdate } from './gameUtils'

export type PiratePhase = 'WAITING' | 'REGISTRATION' | 'PROPOSAL' | 'COMMIT' | 'REVEAL' | 'ENDED'

export type PirateSession = {
  id: number
  phase: PiratePhase
  contractPhase: number
  fee: number
  totalPot: number
  currentRound: number
  totalPirates: number
  alivePirates: number
  currentProposerIndex: number

  hasPlayed: boolean
  myMove: number | null

  hasRegistered: boolean
  isAlive: boolean
  seniorityIndex: number | null
  hasProposed: boolean
  hasVoted: boolean
  hasRevealed: boolean

  proposalExists: boolean
  currentProposal: number[]
  votesFor: number
  votesAgainst: number
  myVote: number | null

  canJoin: boolean
  canReveal: boolean
  canClaim: boolean
  canPropose: boolean
  canVote: boolean
  canResolve: boolean

  claimResult?: { amount: number; timestamp: number; isEliminated?: boolean } | null
  playersCount: number,
  rounds: { start: number; endCommit: number; endReveal: number; current: number }
}

export const usePirateGame = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const { showAlert } = useAlert()

  const [loading, setLoading] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const [activeSessions, setActiveSessions] = useState<PirateSession[]>([])
  const [historySessions, setHistorySessions] = useState<PirateSession[]>([])
  const [mySessions, setMySessions] = useState<PirateSession[]>([])

  // MBR specifico per ogni azione
  const [mbrs, setMbrs] = useState({ create: 0, join: 0 })

  const appId = config.games.pirate.appId

  const getStorageKey = useCallback(
    (sessionId: number) => activeAddress ? `pirate_${appId}_${activeAddress}_${sessionId}` : null,
    [activeAddress, appId],
  )

  const getClient = useCallback(() => {
    const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
    algorand.setDefaultSigner(transactionSigner)
    return new PirateGameClient({ algorand, appId })
  }, [transactionSigner, appId])

  // Helper decode
  const decodeProposal = (rawProposal: any, totalPirates: number): number[] => {
      if (!rawProposal || !rawProposal.distribution) return []
      const dist = rawProposal.distribution
      const result: number[] = []
      for (let i = 0; i < totalPirates; i++) {
          const start = i * 8
          if (start + 8 <= dist.length) {
              const val = algosdk.decodeUint64(dist.slice(start, start + 8), 'safe')
              result.push(Number(val) / 1e6)
          }
      }
      return result
  }

  // --- DATA FETCHING ---
  const refreshData = useCallback(async () => {
    if (!appId || appId === 0n) return

    try {
      const client = getClient()
      const algorand = client.algorand

      // 1. MBR Check & Simulation (Solo per Create/Join generici)
      if (mbrs.create === 0) {
        try {
          const composer = client.newGroup()
          const simSender = activeAddress ?? client.appAddress
          composer.getRequiredMbr({ args: { command: 'newGame' }, sender: simSender })
          composer.getRequiredMbr({ args: { command: 'join' }, sender: simSender })
          const res = await composer.simulate({ allowUnnamedResources: true })
          if (res.returns[0] !== undefined && res.returns[1] !== undefined) {
             setMbrs({
                 create: Number(res.returns[0]) / 1e6,
                 join: Number(res.returns[1]) / 1e6,
             })
          }
        } catch (e) {
            setMbrs({ create: 0.2, join: 0.0281 })
        }
      }

      // 2. Fetch Boxes
      const allBoxesResponse = await algorand.client.algod.getApplicationBoxes(Number(appId)).do()

      if (!allBoxesResponse.boxes || allBoxesResponse.boxes.length === 0) {
        setActiveSessions([]); setHistorySessions([]); setMySessions([]); setIsInitializing(false)
        return
      }

      const sessionIds = new Set<number>()
      allBoxesResponse.boxes.forEach((box: any) => {
        const hex = Buffer.from(box.name).toString('hex')
        if (hex.length >= 16) {
            try {
                const id = parseInt(hex.slice(-16), 16)
                if (!isNaN(id) && id > 0 && id < 1000000) sessionIds.add(id)
            } catch(e) {}
        }
      })

      const status = await algorand.client.algod.status().do()
      const currentRound = Number(status['lastRound'])

      // 3. Parallel Fetch Details
      const sessionPromises = Array.from(sessionIds).map(async (sessionId) => {
        try {
          const [conf, gameState, balance, proposalBox] = await Promise.all([
             client.state.box.gameSessions.value(sessionId).catch(() => null),
             client.state.box.gameState.value(sessionId).catch(() => null),
             client.state.box.sessionBalances.value(sessionId).catch(() => null),
             client.state.box.proposals.value(sessionId).catch(() => null)
          ])

          if (!conf || !gameState) return null

          const fee = Number(conf.participation) / 1e6 || 0
          const totalPot = balance ? Number(balance) / 1e6 : 0
          const contractPhase = Number(gameState.phase)
          const start = Number(conf.startAt)

          let phase: PiratePhase = 'REGISTRATION'
          if (contractPhase === 4) phase = 'ENDED'
          else if (contractPhase === 0) {
              if (currentRound >= start) phase = 'PROPOSAL'
              else phase = 'REGISTRATION'
          }
          else if (contractPhase === 1) phase = 'PROPOSAL'
          else if (contractPhase === 2) phase = 'COMMIT'
          else if (contractPhase === 3) phase = 'REVEAL'

          let currentProposal: number[] = []
          let votesFor = 0
          let votesAgainst = 0

          if (proposalBox) {
              votesFor = Number(proposalBox.votesFor)
              votesAgainst = Number(proposalBox.votesAgainst)
              currentProposal = decodeProposal(proposalBox, Number(gameState.totalPirates))
          }

          const myKey = getStorageKey(sessionId)
          const localJson = myKey ? localStorage.getItem(myKey) : null
          let hasRegistered = false, hasVoted = false, hasRevealed = false
          let myVote = null, claimResult = null, seniorityIndex = null, isAlive = true

          if (localJson) {
            try {
              const p = JSON.parse(localJson)
              hasRegistered = !!p.hasRegistered
              hasVoted = !!p.hasVoted
              hasRevealed = !!p.hasRevealed
              myVote = p.vote ?? null
              seniorityIndex = (p.seniorityIndex !== null) ? Number(p.seniorityIndex) : null
              isAlive = p.isAlive ?? true
              claimResult = p.claimResult || null
            } catch {}
          }

          if (hasRegistered && seniorityIndex !== null && isAlive && contractPhase !== 4) {
            if (seniorityIndex < Number(gameState.currentProposerIndex)) {
              isAlive = false
              claimResult = { amount: -fee, timestamp: Date.now(), isEliminated: true }
              if (myKey) {
                const data = JSON.parse(localStorage.getItem(myKey) || '{}')
                data.isAlive = false; data.claimResult = claimResult
                localStorage.setItem(myKey, JSON.stringify(data))
              }
            }
          }

          const isRegistrationTimeValid = currentRound < start
          const canJoin = (phase === 'REGISTRATION') && !hasRegistered && !!activeAddress && isRegistrationTimeValid
          const canPropose = phase === 'PROPOSAL' && isAlive && seniorityIndex === Number(gameState.currentProposerIndex)
          const canVote = phase === 'COMMIT' && isAlive && !hasVoted && seniorityIndex !== Number(gameState.currentProposerIndex)
          const canReveal = phase === 'REVEAL' && isAlive && hasVoted && !hasRevealed
          const canResolve = phase === 'REVEAL' && currentRound > Number(conf.endRevealAt)
          const canClaim = phase === 'ENDED' && isAlive && hasRegistered && !claimResult

          return {
            id: sessionId,
            phase, contractPhase, fee, totalPot, currentRound,
            totalPirates: Number(gameState.totalPirates),
            alivePirates: Number(gameState.alivePirates),
            currentProposerIndex: Number(gameState.currentProposerIndex),
            hasPlayed: hasRegistered,
            myMove: myVote,
            hasRegistered, isAlive, seniorityIndex, hasProposed: false, hasVoted, hasRevealed,
            proposalExists: !!proposalBox,
            currentProposal, votesFor, votesAgainst, myVote,
            canJoin, canReveal, canClaim, canPropose, canVote, canResolve, claimResult,
            playersCount: Number(gameState.totalPirates),
            rounds: { start, endCommit: Number(conf.endCommitAt), endReveal: Number(conf.endRevealAt), current: currentRound }
          } as PirateSession

        } catch (e) { return null }
      })

      const results = await Promise.all(sessionPromises)
      const sorted = results.filter((s): s is PirateSession => s !== null).sort((a, b) => b.id - a.id)

      setActiveSessions(sorted.filter(s => s.phase !== 'ENDED'))
      setHistorySessions(sorted.filter(s => s.phase === 'ENDED'))
      setMySessions(sorted.filter(s => s.hasRegistered))

    } catch (e: any) { console.error(e) } finally { setIsInitializing(false) }
  }, [appId, activeAddress, getClient, mbrs.create, getStorageKey])

  // --- ACTIONS ---

  const createSession = useCallback(async (fee: number, start: number, commit: number, reveal: number, maxPlayers: number = 20) => {
    setLoading(true)
    try {
        const client = getClient()
        const status = await client.algorand.client.algod.status().do()
        const startAt = BigInt(status['lastRound']) + BigInt(start)
        const feeMicro = BigInt(Math.round((isNaN(fee) ? 1 : fee) * 1e6))
        const mbrPayment = await client.algorand.createTransaction.payment({
            sender: activeAddress!, receiver: client.appAddress, amount: AlgoAmount.Algos(mbrs.create > 0 ? mbrs.create : 0.2)
        })
        await client.send.createSession({
            args: {
                config: { startAt, endCommitAt: startAt + BigInt(commit), endRevealAt: startAt + BigInt(commit) + BigInt(reveal), participation: feeMicro },
                mbrPayment, maxPirates: BigInt(maxPlayers)
            }, sender: activeAddress!, populateAppCallResources: true
        })
        showAlert('Session Initialized!', 'success'); setTimeout(refreshData, 1500)
    } catch(e: any) { showAlert(e.message, 'error') } finally { setLoading(false) }
  }, [activeAddress, getClient, mbrs.create, refreshData, showAlert])

  const registerPirate = useCallback(async (sessionId: number, fee: number) => {
    setLoading(true)
    try {
        if (!activeAddress) throw new Error('Connect Wallet')
        const client = getClient()
        const feeMicro = BigInt(Math.round((fee || 0) * 1e6))

        // JIT Simulation per Join
        let safeJoinMBR = 0.0281
        try {
            const composer = client.newGroup()
            composer.getRequiredMbr({ args: { command: 'join' } })
            const sim = await composer.simulate({ allowUnnamedResources: true })
            if(sim.returns[0]) safeJoinMBR = Number(sim.returns[0]) / 1e6
        } catch(e) { /* fallback */ }

        const payment = await client.algorand.createTransaction.payment({ sender: activeAddress, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(feeMicro) })
        const mbrPayment = await client.algorand.createTransaction.payment({ sender: activeAddress, receiver: client.appAddress, amount: AlgoAmount.Algos(safeJoinMBR) })
        const res = await client.send.registerPirate({ args: { sessionId: BigInt(sessionId), payment, mbrPayment }, sender: activeAddress, populateAppCallResources: true })
        let seniority = Number(res.return)
        if (isNaN(seniority)) {
             const gameState = await client.state.box.gameState.value(sessionId)
             seniority = gameState ? Number(gameState.totalPirates) - 1 : 0
        }
        const key = getStorageKey(sessionId)
        if (key) localStorage.setItem(key, JSON.stringify({ hasRegistered: true, isAlive: true, seniorityIndex: seniority }))
        showAlert(`Joined! Pirate #${seniority}`, 'success'); refreshData()
    } catch(e: any) {
        const msg = e.message || ''
        if (msg.includes('already') || msg.includes('duplicate')) { showAlert('Already registered!', 'info'); refreshData() }
        else showAlert('Join failed', 'error')
    } finally { setLoading(false) }
  }, [activeAddress, getClient, getStorageKey, refreshData, showAlert])

  const proposeDistribution = useCallback(async (sessionId: number, shares: number[]) => {
    setLoading(true)
    try {
        const client = getClient()
        const buffer = new Uint8Array(shares.length * 8)
        shares.forEach((v, i) => buffer.set(algosdk.encodeUint64(v), i * 8))
        await client.send.proposeDistribution({ args: { sessionId: BigInt(sessionId), distribution: buffer }, sender: activeAddress!, populateAppCallResources: true })
        showAlert('Proposal Sent!', 'success'); refreshData()
    } catch(e: any) { showAlert(e.message, 'error') } finally { setLoading(false) }
  }, [activeAddress, getClient, refreshData, showAlert])

  // --- FIX COMMIT VOTE: DYNAMIC MBR FETCH ---
  const commitVote = useCallback(async (sessionId: number, vote: number) => {
    setLoading(true)
    try {
        const { commitHash, salt } = await createCommit(vote, 32)
        const client = getClient()

        // 1. CALCOLO DINAMICO MBR PRIMA DI TUTTO
        // Chiediamo allo smart contract: "Quanto vuoi per 'commitVote'?"
        let safeVoteMBR = 0.05 // Fallback generoso
        try {
            const composer = client.newGroup()
            // Simuliamo la chiamata getRequiredMbr('commitVote')
            composer.getRequiredMbr({ args: { command: 'commitVote' } })
            const simResult = await composer.simulate({ allowUnnamedResources: true })
            if (simResult.returns[0] !== undefined) {
                safeVoteMBR = Number(simResult.returns[0]) / 1e6
                console.log('Dynamic MBR for Vote:', safeVoteMBR)
            }
        } catch(e) {
            console.warn('MBR Sim failed, using fallback', e)
        }

        const mbrPayment = await client.algorand.createTransaction.payment({
            sender: activeAddress!, receiver: client.appAddress, amount: AlgoAmount.Algos(safeVoteMBR)
        })

        await client.send.commitVote({
            args: { sessionId: BigInt(sessionId), voteHash: commitHash, mbrPayment }, sender: activeAddress!, populateAppCallResources: true
        })

        const key = getStorageKey(sessionId)
        if (key) {
            const data = JSON.parse(localStorage.getItem(key) || '{}')
            data.hasVoted = true; data.vote = vote; data.salt = Array.from(salt)
            localStorage.setItem(key, JSON.stringify(data))
        }
        showAlert('Vote Cast!', 'success'); refreshData()
    } catch(e: any) {
        console.error(e)
        showAlert(e.message || 'Vote failed', 'error')
    } finally { setLoading(false) }
  }, [activeAddress, getClient, getStorageKey, refreshData, showAlert])

  const revealVote = useCallback(async (sessionId: number) => {
    setLoading(true)
    try {
        const key = getStorageKey(sessionId)!
        const { vote, salt } = JSON.parse(localStorage.getItem(key)!)
        const client = getClient()
        await client.send.revealVote({ args: { sessionId: BigInt(sessionId), vote: BigInt(vote), salt: new Uint8Array(salt) }, sender: activeAddress!, populateAppCallResources: true })
        const data = JSON.parse(localStorage.getItem(key)!); data.hasRevealed = true
        localStorage.setItem(key, JSON.stringify(data))
        showAlert('Vote Revealed!', 'success'); refreshData()
    } catch(e: any) { showAlert(e.message, 'error') } finally { setLoading(false) }
  }, [activeAddress, getClient, getStorageKey, refreshData, showAlert])

  const executeRound = useCallback(async (sessionId: number) => {
    setLoading(true)
    try {
        const client = getClient()
        await client.send.executeRound({ args: { sessionId: BigInt(sessionId) }, sender: activeAddress!, populateAppCallResources: true })
        showAlert('Round Resolved!', 'success'); refreshData()
    } catch(e: any) { showAlert(e.message, 'error') } finally { setLoading(false) }
  }, [activeAddress, getClient, refreshData, showAlert])

  const claimWinnings = useCallback(async (sessionId: number, fee: number) => {
    setLoading(true)
    try {
        const client = getClient()
        const res = await client.send.claimWinnings({ args: { sessionId: BigInt(sessionId) }, sender: activeAddress!, coverAppCallInnerTransactionFees: true, populateAppCallResources: true })
        let payout = 0
        res.confirmation?.['innerTxns']?.forEach((t: any) => { if (algosdk.encodeAddress(t.txn.txn.rcv) === activeAddress) payout += t.txn.txn.amt })
        const net = (payout / 1e6) - fee
        const key = getStorageKey(sessionId)!
        const data = JSON.parse(localStorage.getItem(key) || '{}')
        data.claimResult = { amount: net, timestamp: Date.now() }
        localStorage.setItem(key, JSON.stringify(data))
        notifyUpdate(); showAlert(`Looted ${payout/1e6} ALGO!`, 'success'); refreshData()
    } catch(e: any) { showAlert(e.message, 'error') } finally { setLoading(false) }
  }, [activeAddress, getClient, getStorageKey, refreshData, showAlert])

  useEffect(() => { refreshData(); const i = setInterval(refreshData, 5000); return () => clearInterval(i) }, [refreshData])
  const joinSession = useCallback(async (id: number, _val: number, fee: number) => registerPirate(id, fee), [registerPirate])
  const revealMove = revealVote

  return { activeSessions, historySessions, mySessions, mbrs, loading, isInitializing, createSession, registerPirate, proposeDistribution, commitVote, revealVote, executeRound, claimWinnings, joinSession, revealMove }
}
