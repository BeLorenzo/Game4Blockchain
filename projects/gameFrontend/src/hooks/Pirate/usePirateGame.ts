/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useWallet } from '@txnlab/use-wallet-react'
import { PirateGameClient } from '../../contracts/PirateGame'
import { config } from '../../config'
import { useAlert } from '../../context/AlertContext'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { PirateGameSession, PirateGamePhase, PirateInfo } from './types'
import { PirateStorage } from './storage'
import { encodeDistribution, createVoteCommit } from './cypto'
import { decodePirateList, getPirateBoxKey } from './contractUtils'

export const usePirateGame = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const { showAlert } = useAlert()

  const [loading, setLoading] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const [activeSessions, setActiveSessions] = useState<PirateGameSession[]>([])
  const [historySessions, setHistorySessions] = useState<PirateGameSession[]>([])
  const [mySessions, setMySessions] = useState<PirateGameSession[]>([])
  const [mbrs, setMbrs] = useState({ create: 0, join: 0, vote: 0 })

  const appId = config.games.pirate.appId

  const getClient = useCallback(() => {
    const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
    algorand.setDefaultSigner(transactionSigner)
    return new PirateGameClient({ algorand, appId })
  }, [transactionSigner, appId])

  // ============================================================
  // REFRESH DATA - Fetch tutte le sessioni
  // ============================================================
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
        composer.getRequiredMbr({ args: { command: 'commitVote' }, sender:  simulatorSender})
          const result = await composer.simulate({ allowUnnamedResources: true })
          if (result.returns[0] !== undefined && result.returns[1] !== undefined) {
            setMbrs({
              create: Number(result.returns[0]) / 1e6,
              join: Number(result.returns[1]) / 1e6,
              vote: Number(result.returns[2]) / 1e6,
            })
          }
        } catch (e) {
          console.warn('MBR simulation failed', e)
        }
      }

      // 1. Bulk Fetch from Box Storage
      const boxGameStates = await client.state.box.gameState.getMap()
      const boxSessions = await client.state.box.gameSessions.getMap()
      const boxBalances = await client.state.box.sessionBalances.getMap()
      const boxPirateLists = await client.state.box.pirateList.getMap()

      const status = await algorand.client.algod.status().do()
      const currentBlock = Number(status['lastRound'])

      const allSessions: PirateGameSession[] = []

      // 2. Itera su tutte le sessioni
      for (const [sessionKey, gameState] of boxGameStates.entries()) {
        const sessionId = Number(sessionKey)
        const config = boxSessions.get(sessionKey)
        const balance = boxBalances.get(sessionKey)
        const pirateListRaw = boxPirateLists.get(sessionKey)

        if (!config) continue

        // Decodifica timing
        const startAt = Number(config.startAt)
        const endCommitAt = Number(config.endCommitAt)
        const endRevealAt = Number(config.endRevealAt)
        const fee = Number(config.participation) / 1e6
        const totalPot = balance ? Number(balance) / 1e6 : 0

        // Decodifica game state
        const phaseNum = Number(gameState.phase)
        const phaseMap: Record<number, PirateGamePhase> = {
          0: 'REGISTRATION',
          1: 'PROPOSAL',
          2: 'VOTE_COMMIT',
          3: 'VOTE_REVEAL',
          4: 'ENDED'
        }
        const phase = phaseMap[phaseNum] || 'REGISTRATION'
        
        const currentRound = Number(gameState.currentRound)
        const totalPirates = Number(gameState.totalPirates)
        const alivePirates = Number(gameState.alivePirates)
        const currentProposerIndex = Number(gameState.currentProposerIndex)

        // Decodifica lista pirati
        const pirateAddresses = decodePirateList(pirateListRaw)
        const pirates: PirateInfo[] = []
        let myPirateInfo: PirateInfo | null = null

        for (let i = 0; i < pirateAddresses.length; i++) {
          const addr = pirateAddresses[i]
          
          try {
            const pirateKey = getPirateBoxKey(sessionId, addr)
            const pirateData = await client.state.box.pirates.value(await pirateKey)

            if (!pirateData) continue

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
          } catch (e) {
            console.warn(`Failed to fetch pirate ${i}:`, e)
          }
        }

        // Fetch proposta (se esiste)
        let currentProposal = null
        if (phase === 'PROPOSAL' || phase === 'VOTE_COMMIT' || phase === 'VOTE_REVEAL' || phase === 'ENDED') {
          try {
            const proposalRaw = await client.state.box.proposals.value(BigInt(sessionId))
            if (proposalRaw && proposalRaw.distribution) {
              const distribution = encodeDistribution(Array.from(proposalRaw.distribution))
              
              currentProposal = {
                proposerIndex: Number(proposalRaw.proposer),
                distribution: distribution.map(micro => micro / 1e6),
                votesFor: Number(proposalRaw.votesFor),
                votesAgainst: Number(proposalRaw.votesAgainst),
                outcome: phase === 'ENDED' ? 'PASSED' : 'PENDING'
              }
            }
          } catch (e) {
            console.warn('Failed to fetch proposal:', e)
          }
        }

        // LocalStorage State
        let myVote = null
        if (activeAddress && myPirateInfo) {
          const storedVote = PirateStorage.getVoteData(Number(appId), activeAddress, sessionId, currentRound)
          
          if (storedVote) {
            myVote = {
              hasCommitted: true,
              hasRevealed: storedVote.hasRevealed,
              voteDirection: storedVote.vote
            }
          } else {
            myVote = {
              hasCommitted: false,
              hasRevealed: false
            }
          }
        }

        // Action Flags
        const canRegister = phase === 'REGISTRATION' && currentBlock < startAt && !myPirateInfo
        const canPropose = phase === 'PROPOSAL' && !!myPirateInfo?.isCurrentProposer && myPirateInfo.alive && !currentProposal
        const canVote = phase === 'VOTE_COMMIT' && !!myPirateInfo?.alive && !myPirateInfo?.isCurrentProposer && currentBlock <= endCommitAt && (!myVote || !myVote.hasCommitted)
        const canReveal = phase === 'VOTE_REVEAL' && !!myVote?.hasCommitted && !myVote?.hasRevealed && currentBlock <= endRevealAt
        
        const isProposalTimeout = phase === 'PROPOSAL' && currentBlock > endCommitAt
        const isCommitTimeout = phase === 'VOTE_COMMIT' && currentBlock > endCommitAt
        const isRevealTimeout = phase === 'VOTE_REVEAL' && currentBlock > endRevealAt
        const canExecute = isProposalTimeout || isCommitTimeout || isRevealTimeout
        
        const canClaim = phase === 'ENDED' && !!myPirateInfo && !myPirateInfo.claimed

        // Determina endPhase
        let endPhase = endCommitAt
        if (phase === 'VOTE_REVEAL') endPhase = endRevealAt
        else if (phase === 'REGISTRATION') endPhase = startAt

        allSessions.push({
          id: sessionId,
          phase,
          fee,
          totalPot,
          pirates,
          alivePiratesCount: alivePirates,
          currentProposerIndex,
          currentProposal,
          myPirateInfo,
          myVote,
          canRegister,
          canPropose,
          canVote,
          canReveal,
          canExecute,
          canClaim,
          rounds: {
            current: currentBlock,
            start: startAt,
            endPhase
          },
          gameRound: currentRound
        } as PirateGameSession)
      }

      // 3. Sort e filtra
      const sorted = allSessions.sort((a, b) => b.id - a.id)
      setActiveSessions(sorted.filter(s => s.phase !== 'ENDED'))
      setHistorySessions(sorted.filter(s => s.phase === 'ENDED'))
      setMySessions(sorted.filter(s => s.myPirateInfo !== null))

    } catch (e: any) {
      console.error('Fetch error:', e)
    } finally {
      setIsInitializing(false)
    }
  }, [appId, activeAddress, getClient])

  // ============================================================
  // ACTIONS
  // ============================================================

  const createSession = async (
    fee: number,
    maxPirates: number,
    regDuration: number,
    commitDuration: number,
    revealDuration: number
  ) => {
    setLoading(true)

    try {
      if (!activeAddress) throw new Error('Connect your wallet.')
      const client = getClient()
      const algorand = client.algorand
      
      const status = await algorand.client.algod.status().do()
      const currentRound = status['lastRound']

      const startAt = currentRound + BigInt(regDuration)
      const endCommitAt = startAt + BigInt(commitDuration)
      const endRevealAt = endCommitAt + BigInt(revealDuration)
      const participationFee = fee

      const payment = await algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgo(mbrs.create),
      })

      await client.send.createSession({
        args: {
          config: { startAt, endCommitAt, endRevealAt, participation: BigInt(participationFee) },
          mbrPayment: { txn: payment, signer: transactionSigner },
          maxPirates: BigInt(maxPirates)
        },
        sender: activeAddress,
      })
      showAlert('Pirate session created!', 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const registerPirate = async (sessionId: number, participationFee: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect your wallet.')
      const client = getClient()

      const feeMicro = Math.round(participationFee * 1e6)

      const feePayment = await client.algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgo(feeMicro),
      })

      const mbrPayment = await client.algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgo(mbrs.join),
      })

      await client.send.registerPirate({
        args: {
          sessionId: BigInt(sessionId),
          payment: { txn: feePayment, signer: transactionSigner },
          mbrPayment: { txn: mbrPayment, signer: transactionSigner }
        },
        sender: activeAddress,
      })

      PirateStorage.setRegistered(Number(appId), activeAddress, sessionId)
      showAlert('Registered as pirate!', 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const proposeDistribution = async (sessionId: number, distribution: number[], totalPot: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect your wallet.')
      const client = getClient()

      // Validazioni
      const totalDist = distribution.reduce((a, b) => a + b, 0)
      if (Math.abs(totalDist - totalPot) > 0.001) {
        throw new Error(`Sum (${totalDist}) doesn't match pot (${totalPot})`)
      }

      const distMicro = distribution.map(d => Math.round(d * 1e6))
      const encodedDist = encodeDistribution(distMicro)

      await client.send.proposeDistribution({
        args: {
          sessionId: BigInt(sessionId),
          distribution: encodedDist
        },
        sender: activeAddress,
      })

      showAlert('Distribution proposed!', 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const commitVote = async (sessionId: number, vote: 0 | 1, currentRound: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect your wallet.')
      const client = getClient()

      const { hash, salt } = await createVoteCommit(vote)

      const mbrPayment = await client.algorand.createTransaction.payment({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgo(mbrs.vote),
      })

      await client.send.commitVote({
        args: {
          sessionId: BigInt(sessionId),
          voteHash: hash,
          mbrPayment: { txn: mbrPayment, signer: transactionSigner }
        },
        sender: activeAddress,
      })

      PirateStorage.saveVoteCommit(Number(appId), activeAddress, sessionId, currentRound, vote, Array.from(salt))
      showAlert('Vote committed!', 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const revealVote = async (sessionId: number, currentRound: number) => {
    setLoading(true)
    try {
      if (!activeAddress) throw new Error('Connect your wallet.')
      const storedData = PirateStorage.getVoteData(Number(appId), activeAddress, sessionId, currentRound)
      
      if (!storedData) throw new Error('Vote data not found.')
      
      const client = getClient()
      const saltBytes = new Uint8Array(storedData.salt)

      await client.send.revealVote({
        args: {
          sessionId: BigInt(sessionId),
          vote: BigInt(storedData.vote),
          salt: saltBytes
        },
        sender: activeAddress,
      })

      PirateStorage.markVoteRevealed(Number(appId), activeAddress, sessionId, currentRound)
      showAlert('Vote revealed!', 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const executeRound = async (sessionId: number) => {
    setLoading(true)
    try {
      const client = getClient()

      await client.send.executeRound({
        args: { sessionId: BigInt(sessionId) },
        sender: activeAddress!,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(6000),
      })

      showAlert('Round executed!', 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const claimWinnings = async (sessionId: number) => {
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

      const wonMicroAlgo = result.return ? Number(result.return) : 0
      const wonAlgo = wonMicroAlgo / 1e6

      PirateStorage.saveClaim(Number(appId), activeAddress, sessionId, wonAlgo)
      showAlert(`Claimed ${wonAlgo.toFixed(4)} ALGO!`, 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleTimeout = async (sessionId: number) => {
    setLoading(true)
    try {
      const client = getClient()

      await client.send.timeOut({
        args: { sessionId: BigInt(sessionId),  },
        sender: activeAddress!,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(6000),
      })

      showAlert('Timeout handled!', 'success')
      refreshData()
    } catch (e: any) {
      showAlert(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Auto-refresh
  useEffect(() => {
    refreshData()
    const interval = setInterval(refreshData, 5000)
    return () => clearInterval(interval)
  }, [refreshData, activeAddress])

  return {
    sessions: [...activeSessions, ...historySessions], // Tutte le sessioni per la dashboard
    activeSessions,
    historySessions,
    mySessions,
    loading,
    isInitializing,
    actions: {
      create: createSession,
      register: registerPirate,
      propose: proposeDistribution,
      vote: commitVote,
      reveal: revealVote,
      execute: executeRound,
      claim: claimWinnings,
      timeout: handleTimeout
    }
  }
}