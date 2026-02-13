/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from 'react'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useWallet } from '@txnlab/use-wallet-react'
import { PirateGameClient } from '../../contracts/PirateGame'
import { config } from '../../config'
import { useAlert } from '../../context/AlertContext'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { PirateGameSession, PirateGamePhase, PirateInfo } from './types'
import { PirateStorage } from './storage'
import { decodePirateList, encodeDistribution, decodeDistribution, getPirateBoxKey, createVoteCommit } from './contractUtils'
import algosdk, { TransactionSigner } from 'algosdk'
import { useTransactionToast } from '../../context/TransactionToast'

/**
 * Custom React hook for managing Pirate Game interactions.
 * 
 * The Pirate Game is a multi-round bargaining game where:
 * - Players register as pirates with seniority ranking
 * - The oldest alive pirate (captain) proposes a distribution of treasure
 * - All pirates vote on the proposal (commit/reveal pattern)
 * - If ≥50% approve: distribution passes, game ends
 * - If rejected: captain is eliminated, next pirate becomes captain
 * - Process repeats until proposal passes or only 2 pirates remain
 * 
 * Provides:
 * - Session state management (active, history, user's sessions)
 * - Game actions (register, propose, vote, execute, claim)
 * - Real-time data synchronization with blockchain
 * - MBR (Minimum Balance Requirement) calculation
 * - Complex game logic with phase transitions and timeout handling
 * - Local storage persistence for votes and game state
 */
export const usePirateGame = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const { showAlert } = useAlert()
  const { showToast } = useTransactionToast()

  const [loading, setLoading] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const [activeSessions, setActiveSessions] = useState<PirateGameSession[]>([])
  const [historySessions, setHistorySessions] = useState<PirateGameSession[]>([])
  const [mySessions, setMySessions] = useState<PirateGameSession[]>([])
  const [mbrs, setMbrs] = useState({ create: 0, join: 0, vote: 0 })

  const hasLoggedErrorRef = useRef(new Set<string>())
  const appId = config.games.pirate.appId

  /**
   * Creates and configures a PirateGameClient instance.
   */
  const getClient = useCallback(() => {
    const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
    algorand.setDefaultSigner(transactionSigner)
    return new PirateGameClient({ algorand, appId })
  }, [transactionSigner, appId])

     /**
     * Creates and configures a RockPaperScissorsClient instance for the MBR simulation.
     */
    const getSimClient = useCallback(() => {
    const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
    return new PirateGameClient({ algorand, appId })
  }, [appId])

  /**
   * Safely fetches a value from a contract box, suppressing repeated errors.
   * This function prevents console spam by logging each missing box only once.
   */
  const safeFetchBoxValue = async (boxAccessor: any, key: any, label: string) => {
    const keyStr = String(key)
    if (hasLoggedErrorRef.current.has(keyStr)) return undefined
    try {
      return await boxAccessor.value(key)
    } catch (e) {
      if (!hasLoggedErrorRef.current.has(keyStr)) {
        console.warn(`[SKIP] Unreadable data in ${label} (Key: ${keyStr}).`)
        hasLoggedErrorRef.current.add(keyStr)
      }
      return undefined
    }
  }

  /**
   * Fetches and processes all Pirate Game session data from the blockchain.
   * 
   * This function:
   * 1. Calculates MBR requirements if not already known
   * 2. Reads session configuration, state, and balances from contract boxes
   * 3. Handles complex phase transitions and timeout logic
   * 4. Decodes pirate lists and proposal data
   * 5. Updates local state with categorized sessions
   * 6. Auto-calculates and saves P/L results for completed games
   */
  const refreshData = useCallback(async () => {
    if (!appId || appId === 0n) return

    try {
      const client = getSimClient()
      const algorand = client.algorand

      if (mbrs.create === 0 && activeAddress) {
        try {
         
          const simulatorSender = activeAddress
          const composer = client.newGroup()

          composer.getRequiredMbr({ args: { command: 'newGame' }, sender: simulatorSender })
          composer.getRequiredMbr({ args: { command: 'join' }, sender: simulatorSender })
          composer.getRequiredMbr({ args: { command: 'commitVote' }, sender: simulatorSender })
          const result = await composer.simulate({ allowUnnamedResources: true, skipSignatures: true})
          if (result.returns[0] !== undefined) {
             setMbrs({
               create: Number(result.returns[0]) / 1e6,
               join: Number(result.returns[1]) / 1e6,
               vote: Number(result.returns[2]) / 1e6,
             })
          }
        } catch (e) { }
      }

      const status = await algorand.client.algod.status().do()
      const currentBlockHeight = Number(status['lastRound'])

      let gameStatesMap = new Map()
      try { gameStatesMap = await client.state.box.gameState.getMap() } 
      catch (e) { console.error("GameStates map error", e); return }

      let balancesMap = new Map()
      try { balancesMap = await client.state.box.sessionBalances.getMap() } catch(e) {  }
      
      let pirateListsMap = new Map()
      try { pirateListsMap = await client.state.box.pirateList.getMap() } catch(e) { }

      const balMapStr = new Map(Array.from(balancesMap).map(([k, v]) => [String(k), v]))
      const plMapStr = new Map(Array.from(pirateListsMap).map(([k, v]) => [String(k), v]))

      const allSessions: PirateGameSession[] = []

      for (const [key, gameState] of gameStatesMap.entries()) {
        const id = Number(key)
        const keyStr = String(key)

        let config: any = undefined
        try {
           config = await client.state.box.gameSessions.value(BigInt(id))
        } catch (e) {
           config = { startAt: 0n, endCommitAt: 0n, endRevealAt: 0n, participation: 0n }
        }

        const startAt = Number(config.startAt)
        const endCommitAt = Number(config.endCommitAt)
        const endRevealAt = Number(config.endRevealAt)
        const fee = Number(config.participation) / 1e6

        const balance = balMapStr.get(keyStr)
        const totalPot = balance ? Number(balance) / 1e6 : 0
        const pirateListRaw = plMapStr.get(keyStr)

        let phaseNum = Number(gameState?.phase)
        const alivePirates = Number(gameState?.alivePirates || 0)

        const currentGameRound = Number(gameState?.currentRound || 0) 
        const currentProposerIndex = Number(gameState?.currentProposerIndex || 0)
              
        
        // 1. REFUND: If time expired and too few pirates -> ENDED (Goes to History)
        if (phaseNum === 0 && currentBlockHeight >= startAt && alivePirates < 3) {
            phaseNum = 4 
        }
        
        // 2. DEADLOCK: If time expired and enough pirates -> PROPOSAL (Unlocks captain form)
        if (phaseNum === 0 && currentBlockHeight >= startAt && alivePirates >= 3) {
            phaseNum = 1 
        }

        // 3. REVEAL: If commit time expired -> REVEAL (Unlocks reveal button)
        if (phaseNum === 2 && currentBlockHeight > endCommitAt) {
            phaseNum = 3 
        }

        const phaseMap: Record<number, PirateGamePhase> = {
          0: 'REGISTRATION', 1: 'PROPOSAL', 2: 'VOTE_COMMIT', 3: 'VOTE_REVEAL', 4: 'ENDED'
        }
        const phase = phaseMap[phaseNum] || 'REGISTRATION'
        
        const pirateAddresses = decodePirateList(pirateListRaw)
        const pirates: PirateInfo[] = []
        let myPirateInfo: PirateInfo | null = null

        for (let i = 0; i < pirateAddresses.length; i++) {
          const addr = pirateAddresses[i]
          try {
            const pirateKey = await getPirateBoxKey(id, addr)
            const pirateData = await safeFetchBoxValue(client.state.box.pirates, pirateKey, `Pirate ${addr}`)
            
            if (!pirateData) continue;

            const isMe = activeAddress === addr
            const isCurrentProposer = i === currentProposerIndex

            const info: PirateInfo = {
              address: addr,
              seniorityIndex: Number(pirateData.seniorityIndex),
              alive: pirateData.alive,
              isCurrentProposer: isCurrentProposer && pirateData.alive,
              claimed: pirateData.claimed
            }
            pirates.push(info)
            if (isMe) myPirateInfo = info
          } catch (e) {  }
        }

        let currentProposal = null
        if (['PROPOSAL', 'VOTE_COMMIT', 'VOTE_REVEAL', 'ENDED'].includes(phase)) {
           const proposalRaw = await safeFetchBoxValue(client.state.box.proposals, BigInt(id), 'Proposal')
           if (proposalRaw && proposalRaw.distribution) {
              const proposerIdx = Number(proposalRaw.proposer)
              if (phase === 'ENDED' || proposerIdx === currentProposerIndex) {
                  const distribution = decodeDistribution(proposalRaw.distribution)
                  const rawVotesFor = Number(proposalRaw.votesFor)
                  
                  currentProposal = {
                    proposerIndex: proposerIdx,
                    distribution: distribution, 
                    votesFor: rawVotesFor, 
                    votesAgainst: Number(proposalRaw.votesAgainst),
                    outcome: phase === 'ENDED' ? 'PASSED' : 'PENDING'
                  }
              }
           }
        }

        // Get user's vote status from local storage
        let myVote = null
        if (activeAddress && myPirateInfo) {
          const storedVote = PirateStorage.getVoteData(Number(appId), activeAddress, id, currentGameRound)
           if (storedVote) {
             myVote = { hasCommitted: true, hasRevealed: storedVote.hasRevealed, voteDirection: storedVote.vote }
           } else {
             myVote = { hasCommitted: false, hasRevealed: false }
           }
        }

        // CLAIM RESULT CALCULATION AND AUTO-SAVE ---
        let claimResult = null
        if (activeAddress) {
            claimResult = PirateStorage.getClaim(Number(appId), activeAddress, id)
        }

        if (claimResult && activeAddress) {
            const myPirateEntry = pirates.find(p => p.address === activeAddress)
            if (myPirateEntry) {
                myPirateEntry.claimed = true
            }

            if (myPirateInfo) {
                myPirateInfo.claimed = true
            }
        }

        // Calculate P/L if no claim exists yet
        if (!claimResult && myPirateInfo && activeAddress) {
            let amountToSave: number | null = null

            // ELIMINATED: Player died during game (loses fee)
            if (!myPirateInfo.alive) {
                amountToSave = -fee
                PirateStorage.saveClaim(Number(appId), activeAddress, id, amountToSave, false)
                claimResult = { amount: amountToSave, isTimeout: false, timestamp: Date.now(), isWin: false }
            }
        }

        // --- ACTION PERMISSIONS ---
        const canRegister = phase === 'REGISTRATION' && currentBlockHeight < startAt && !myPirateInfo
        const canPropose = phase === 'PROPOSAL' && !!myPirateInfo?.isCurrentProposer && myPirateInfo.alive && !currentProposal
        
        const canVote = phase === 'VOTE_COMMIT' 
                        && !!myPirateInfo?.alive 
                        && currentBlockHeight <= endCommitAt 
                        && (!myVote || !myVote.hasCommitted)    

        const canReveal = (phase === 'VOTE_REVEAL' || (phase === 'VOTE_COMMIT' && currentBlockHeight > endCommitAt)) 
                          && !!myVote?.hasCommitted 
                          && !myVote?.hasRevealed

        const isProposalTimeout = phase === 'PROPOSAL' && currentBlockHeight > endCommitAt
        const canExecute = isProposalTimeout || (phase === 'ENDED' && currentBlockHeight >= startAt && pirates.length < 3 && myPirateInfo && !myPirateInfo.claimed) || (phase === 'VOTE_REVEAL' && currentBlockHeight > endRevealAt)
        
        const canClaim = phase === 'ENDED' && !!myPirateInfo && !myPirateInfo.claimed && pirates.length >= 3

        let endPhase = endCommitAt
        if (phase === 'VOTE_REVEAL') endPhase = endRevealAt
        else if (phase === 'REGISTRATION') endPhase = startAt

        allSessions.push({
          id, phase, fee, totalPot, pirates, alivePiratesCount: alivePirates,
          currentProposerIndex, currentProposal, myPirateInfo, myVote, claimResult,
          canRegister, canPropose, canVote, canReveal, canExecute, canClaim,
          rounds: { current: currentBlockHeight, start: startAt, endPhase },
          gameRound: currentGameRound
        } as PirateGameSession)
      }

      const sorted = allSessions.sort((a, b) => b.id - a.id)
      setActiveSessions(sorted.filter(s => s.phase !== 'ENDED' || (s.phase === 'ENDED' && s.myPirateInfo && !s.myPirateInfo.claimed)))
      setHistorySessions(sorted.filter(s => s.phase === 'ENDED'))
      setMySessions(sorted.filter(s => s.myPirateInfo !== null))

    } catch (e: any) {
      console.error('Refresh Error:', e)
    } finally {
      setIsInitializing(false)
    }
  }, [appId, activeAddress, getClient, mbrs.create])


  /**
   * Creates a new Pirate Game session.
   */
  const createSession = async (fee: number, maxPirates: number, regDuration: number, commitDuration: number, revealDuration: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect your wallet.')
      const client = getClient()
      const participationFee = algosdk.algosToMicroalgos(fee)
      const status = await client.algorand.client.algod.status().do()
      const currentRound = BigInt(status['lastRound'])
      const startAt = currentRound + BigInt(regDuration)
      const endCommitAt = startAt + BigInt(commitDuration)
      const endRevealAt = endCommitAt + BigInt(revealDuration)

      const payment = await client.algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgo(algosdk.algosToMicroalgos(mbrs.create)),
      })

      const result = await client.send.createSession({
        args: {
          config: { startAt, endCommitAt, endRevealAt, participation: BigInt(participationFee) },
          mbrPayment: { txn: payment, signer: transactionSigner },
          maxPirates: BigInt(maxPirates)
        },
        sender: activeAddress,
      })
      showToast({
        agentName: activeAddress.substring(0,6),
        txId: result.transaction.txID(),
        type: 'CREATE'
      })
      showAlert('Pirate session created!', 'success')
      setTimeout(() => refreshData(), 1000) // Refresh after short delay
    } catch (e: any) { console.error(e); showAlert(e.message, 'error') } finally { setLoading(false) }
  }

  /**
   * Registers the current wallet as a pirate in a session.
   */
  const registerPirate = async (sessionId: number, participationFee: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect your wallet.')
      const client = getClient()
      const feeMicro = algosdk.algosToMicroalgos(participationFee)
      const feePayment = await client.algorand.createTransaction.payment({ sender: activeAddress, receiver: client.appAddress, amount: AlgoAmount.MicroAlgo(feeMicro) })
      const mbrPayment = await client.algorand.createTransaction.payment({ sender: activeAddress, receiver: client.appAddress, amount: AlgoAmount.MicroAlgo(algosdk.algosToMicroalgos(mbrs.join)) })
      const result = await client.send.registerPirate({ args: { sessionId: BigInt(sessionId), payment: { txn: feePayment, signer: transactionSigner }, mbrPayment: { txn: mbrPayment, signer: transactionSigner } }, sender: activeAddress })
      PirateStorage.setRegistered(Number(appId), activeAddress, sessionId)
      showToast({
        agentName: activeAddress.substring(0,6),
        txId: result.transaction.txID(),
        type: 'JOIN'
      })
      showAlert('Registered as pirate!', 'success')
      setTimeout(() => refreshData(), 1000)
    } catch (e: any) { console.error(e); showAlert(e.message, 'error') } finally { setLoading(false) }
  }

  /**
   * Proposes a treasure distribution as the current captain.
   */
  const proposeDistribution = async (sessionId: number, distribution: number[], totalPot: number) => {
      setLoading(true)
      try {
        if (!activeAddress) throw new Error('Connect your wallet.')
        const client = getClient()
        const distMicro = distribution.map(d => Math.round(d * 1e6)) 
        const encodedDist = encodeDistribution(distMicro)
        const result = await client.send.proposeDistribution({ args: { sessionId: BigInt(sessionId), distribution: encodedDist }, sender: activeAddress, coverAppCallInnerTransactionFees: true, maxFee: AlgoAmount.MicroAlgo(3000) })
        showAlert('Distribution proposed!', 'success')
        showToast({
        agentName: activeAddress.substring(0,6),
        txId: result.transaction.txID(),
        type: 'PROPOSE'
      })
        setTimeout(() => refreshData(), 1000)
      } catch (e: any) { console.error(e); showAlert(e.message, 'error') } finally { setLoading(false) }
  }

  /**
   * Commits a vote on the current proposal (commit/reveal pattern).
   */
  const commitVote = async (sessionId: number, vote: 0 | 1, gameRound: number) => {
     setLoading(true)
     try {
       if (!activeAddress) throw new Error('Connect your wallet.')
       const client = getClient()
       const { commitHash, salt } = await createVoteCommit(vote)
       const mbrPayment = await client.algorand.createTransaction.payment({ sender: activeAddress, receiver: client.appAddress, amount: AlgoAmount.MicroAlgo(algosdk.algosToMicroalgos(mbrs.vote)) })
       
       const result = await client.send.commitVote({ args: { sessionId: BigInt(sessionId), voteHash: commitHash, mbrPayment: { txn: mbrPayment, signer: transactionSigner } }, sender: activeAddress })
       
       PirateStorage.saveVoteCommit(Number(appId), activeAddress, sessionId, gameRound, vote, Array.from(salt))
       showAlert('Vote committed!', 'success')
       showToast({
        agentName: activeAddress.substring(0,6),
        txId: result.transaction.txID(),
        type: 'COMMIT'
        })
       setTimeout(() => refreshData(), 1000)
     } catch (e: any) { console.error(e); showAlert(e.message, 'error') } finally { setLoading(false) }
  }

  /**
   * Reveals a previously committed vote.
   */
  const revealVote = async (sessionId: number, gameRound: number) => {
      setLoading(true)
      try {
        if (!activeAddress) throw new Error('Connect your wallet.')
        const storedData = PirateStorage.getVoteData(Number(appId), activeAddress, sessionId, gameRound)
        if (!storedData) throw new Error('Vote data not found locally.')
        
        const client = getClient()
        const saltBytes = new Uint8Array(storedData.salt)
        const result = await client.send.revealVote({ args: { sessionId: BigInt(sessionId), vote: BigInt(storedData.vote), salt: saltBytes }, sender: activeAddress })
        
        PirateStorage.markVoteRevealed(Number(appId), activeAddress, sessionId, gameRound)
        showAlert('Vote revealed!', 'success')
        showToast({
        agentName: activeAddress.substring(0,6),
        txId: result.transaction.txID(),
        type: 'REVEAL'
        })
        setTimeout(() => refreshData(), 1000)
      } catch (e: any) { console.error(e); showAlert(e.message, 'error') } finally { setLoading(false) }
  }

  /**
   * Executes the current round (advances game state).
   * 
   * Called when:
   * - Proposal timeout occurs
   * - Vote reveal phase ends
   * - Game needs to advance to next round
   */
  const executeRound = async (sessionId: number) => {
      setLoading(true)
      try {
        const client = getClient()
        const result = await client.send.executeRound({ args: { sessionId: BigInt(sessionId) }, sender: activeAddress!, coverAppCallInnerTransactionFees: true, maxFee: AlgoAmount.MicroAlgo(6000) })
        showAlert('Round executed!', 'success')
        showToast({
        agentName: activeAddress!.substring(0,6),
        txId: result.transaction.txID(),
        type: 'EXECUTE'
        })
        setTimeout(() => refreshData(), 1000)
      } catch (e: any) { console.error(e); showAlert(e.message, 'error') } finally { setLoading(false) }
  }

  /**
   * Claims winnings from a completed session.
   * 
   * Determines payout based on:
   * - Whether proposal passed
   * - User's vote and status
   * - Distribution allocation
   */
  const claimWinnings = async (sessionId: number, entryFee: number) => {
      setLoading(true)
      try {
        if (!activeAddress) throw new Error('Connect your wallet.')
        const client = getClient()
        
        const result = await client.send.claimWinnings({ 
            args: { sessionId: BigInt(sessionId) }, 
            sender: activeAddress, 
            coverAppCallInnerTransactionFees: true, 
            maxFee: AlgoAmount.MicroAlgo(6000) 
        })
        
        const rawReturn = result.return ? Number(result.return) : 0
        const grossPayout = rawReturn / 1e6 
        const netProfit = grossPayout - entryFee
        
        PirateStorage.saveClaim(Number(appId), activeAddress, sessionId, netProfit)
        showAlert(`Victory! Claimed ${grossPayout.toFixed(2)} ALGO!`, 'success')
        showToast({
        agentName: activeAddress.substring(0,6),
        txId: result.transaction.txID(),
        type: 'CLAIM'
        })
        refreshData()
      } catch (e: any) { 
      const errorMsg = e.message || JSON.stringify(e)
      if (errorMsg.includes('No winnings for you')) {
            PirateStorage.saveClaim(Number(appId), activeAddress!, sessionId, -entryFee)
            showAlert(`Game Over. You lost ${entryFee.toFixed(2)} ALGO.`, 'error')
            refreshData()
        } 
        else if (errorMsg.includes('Already claimed')) {
            PirateStorage.saveClaim(Number(appId), activeAddress!, sessionId, -entryFee)
            refreshData()
            showAlert('Game already closed.', 'error')
        }
        else {
            console.error(e)
            showAlert(errorMsg, 'error')
        }
      } finally { setLoading(false) }
  }

  /**
   * Handles timeout for a session.
   * 
   * Used for:
   * - Games cancelled due to insufficient players
   * - Captain elimination due to proposal timeout
   * - Force-advancing stuck game state
   */
  const handleTimeout = async (sessionId: number) => {
       setLoading(true)
       try {
         const session = [...activeSessions, ...historySessions, ...mySessions].find(s => s.id === sessionId)
         if (!session) throw new Error('Session not found')

         const client = getClient()
         
         await client.send.timeOut({ 
            args: { sessionId: BigInt(sessionId) }, 
            sender: activeAddress!, 
            coverAppCallInnerTransactionFees: true, 
            maxFee: AlgoAmount.MicroAlgo(6000) 
         })
         
         const isGameCancelled = session.phase === 'REGISTRATION' || 
                                 (session.phase === 'ENDED' && session.pirates.length < 3)
         if (isGameCancelled) {
             PirateStorage.saveClaim(Number(appId), activeAddress!, sessionId, 0, true)
             showAlert('Game Cancelled & Refunded!', 'success')
         } else {
             showAlert('Captain Eliminated! Next round starts.', 'success')
         }
         setTimeout(() => refreshData(), 1000)
       } catch (e: any) { 
           console.error(e)
           showAlert(e.message, 'error') 
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
    const interval = setInterval(refreshData, 5000)
    return () => clearInterval(interval)
  }, [activeAddress, appId]) 

  return {
    sessions: [...activeSessions, ...historySessions],
    activeSessions,
    historySessions,
    mySessions,
    mbrs,
    loading,
    isInitializing,
    actions: { createSession, registerPirate, proposeDistribution, commitVote, revealVote, executeRound, claimWinnings, handleTimeout }
  }
}