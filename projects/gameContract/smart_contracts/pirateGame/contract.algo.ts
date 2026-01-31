import {
  assert,
  BoxMap,
  bytes,
  clone,
  ensureBudget,
  Global,
  gtxn,
  itxn,
  op,
  Txn,
  uint64,
} from '@algorandfoundation/algorand-typescript'
import { Address } from '@algorandfoundation/algorand-typescript/arc4'
import { GameConfig, GameContract } from '../abstract_contract/contract.algo'
import { bzero, extractUint64, itob } from '@algorandfoundation/algorand-typescript/op'

/**
 * Represents a pirate in the game.
 */
interface Pirate {
  pirateAddress: Address
  seniorityIndex: uint64 // 0 = most senior
  alive: boolean
  claimed: boolean
}

/**
 * Tracks the current state of the game session.
 */
interface GameState {
  phase: uint64 // 0=Registration, 1=Proposal, 2=VoteCommit, 3=VoteReveal, 4=Finished
  currentRound: uint64 // Which elimination round (0, 1, 2...)
  totalPirates: uint64 // Initial number of pirates
  alivePirates: uint64 // Pirates still alive
  currentProposerIndex: uint64 // Seniority index of current proposer
  pot: uint64 // Total coins to distribute
  commitDuration: uint64
  revealDuration: uint64
}

/**
 * A distribution proposal submitted by a pirate.
 */
interface Proposal {
  proposer: uint64
  distribution: bytes
  votesFor: uint64
  votesAgainst: uint64
}

export class PirateGame extends GameContract {
  gameState = BoxMap<uint64, GameState>({ keyPrefix: 'gst' })
  pirates = BoxMap<bytes, Pirate>({ keyPrefix: 'pir' })
  pirateList = BoxMap<uint64, bytes>({ keyPrefix: 'pls' })
  proposals = BoxMap<uint64, Proposal>({ keyPrefix: 'prp' })

  /**
   * Initializes a new game session with the provided configuration.
   * Validates the Minimum Balance Requirement (MBR) payment.
   */
  public createSession(
    config: GameConfig,
    mbrPayment: gtxn.PaymentTxn,
    maxPirates: uint64,
  ): uint64 {
    assert(maxPirates >= 3 && maxPirates <= 20, 'Pirates must be between 3 and 20')
    assert(config.participation >= 1_000_000, 'Minimum participation is 1 ALGO')

    const requiredMBR = this.getRequiredMBR('newGame')
    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment receiver must be contract')
    assert(mbrPayment.amount >= requiredMBR, 'Insufficient MBR')

    const sessionID = super.create(config)

    const commitDuration: uint64 = config.endCommitAt - config.startAt
    const revealDuration: uint64 = config.endRevealAt - config.endCommitAt

    this.gameState(sessionID).value = {
      phase: 0,
      currentRound: 0,
      totalPirates: 0,
      alivePirates: 0,
      currentProposerIndex: 0,
      pot: 0,
      commitDuration: commitDuration,
      revealDuration: revealDuration
    }

    this.pirateList(sessionID).value = bzero(maxPirates * 32)
    return sessionID
  }

  /**
   * Allows a player to join the game during the registration phase.
   * Requires the player to cover their own data storage cost (MBR).
   */
  public registerPirate(sessionID: uint64, payment: gtxn.PaymentTxn, mbrPayment: gtxn.PaymentTxn): void {
    assert(this.sessionExists(sessionID), 'Session does not exist')

    const state = clone(this.gameState(sessionID).value)
    const config = clone(this.gameSessions(sessionID).value)

    assert(Global.round < config.startAt, 'Registration closed (Game Started)')
    assert(state.phase === 0, 'Registration phase has ended')
    assert(state.totalPirates < 20, 'Max pirates reached')

    const pirateAddr = new Address(Txn.sender)
    const pirateKey = super.getPlayerKey(sessionID, pirateAddr)

    assert(!this.pirates(pirateKey).exists, 'Already registered')

    const requiredMBR = this.getRequiredMBR('join')
    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment receiver must be contract')
    assert(mbrPayment.amount >= requiredMBR, 'Insufficient MBR for pirate registration')

    const maxPirates: uint64 = this.pirateList(sessionID).value.length / 32
    assert(state.totalPirates < maxPirates, 'Game is full')

    super.joinWithoutCommit(sessionID, payment)

    const seniorityIndex = state.totalPirates

    this.pirates(pirateKey).value = {
      pirateAddress: pirateAddr,
      seniorityIndex: seniorityIndex,
      alive: true,
      claimed: false,
    }

    const listBox = this.pirateList(sessionID)
    const offset: uint64 = seniorityIndex * 32
    listBox.replace(offset, pirateAddr.bytes)

    state.totalPirates += 1
    state.alivePirates += 1
    state.pot += payment.amount
    this.gameState(sessionID).value = clone(state)
  }

  /**
   * Submits a distribution proposal. Can only be called by the current proposer.
   * The distribution byte array must match the total pot amount.
   */
  public proposeDistribution(sessionID: uint64, distribution: bytes): void {
    ensureBudget(1000)
    assert(this.sessionExists(sessionID), 'Session does not exist')

    const state = clone(this.gameState(sessionID).value)
    const config = clone(this.gameSessions(sessionID).value)

    assert(Global.round >= config.startAt, 'Game not started yet')

    const pirateAddr = new Address(Txn.sender)
    const pirateKey = super.getPlayerKey(sessionID, pirateAddr)
    assert(this.pirates(pirateKey).exists, 'Not registered')

    if (state.phase === 0) {
      assert(state.totalPirates >= 3, 'Not enough pirates to start')
      state.phase = 1
    }
    assert(state.phase === 1, 'Not in proposal phase')

    const pirate = clone(this.pirates(pirateKey).value)
    assert(pirate.alive, 'You are eliminated')
    assert(pirate.seniorityIndex === state.currentProposerIndex, 'Not your turn to propose')

    const expectedLength: uint64 = state.totalPirates * 8
    assert(distribution.length === expectedLength, 'Invalid distribution length')

    let totalProposed: uint64 = 0
    for (let i: uint64 = 0; i < state.totalPirates; i++) {
      const share = extractUint64(distribution, i * 8)
      totalProposed += share
    }
    assert(totalProposed === state.pot, 'Distribution must sum to pot')

    this.proposals(sessionID).value = {
      proposer: state.currentProposerIndex,
      distribution: distribution,
      votesFor: 0,
      votesAgainst: 0,
    }

    state.phase = 2
    this.gameState(sessionID).value = clone(state)
  }

  /**
   * Commits a hashed vote during the voting phase.
   */
  public commitVote(sessionID: uint64, voteHash: bytes, mbrPayment: gtxn.PaymentTxn): void {
    assert(this.sessionExists(sessionID), 'Session does not exist')
    const state = clone(this.gameState(sessionID).value)
    const config = clone(this.gameSessions(sessionID).value)

    assert(state.phase === 2, 'Not in voting phase')
    assert(Global.round <= config.endCommitAt, 'Voting deadline passed')

    const pirateAddr = new Address(Txn.sender)
    const pirateKey = super.getPlayerKey(sessionID, pirateAddr)
    assert(this.pirates(pirateKey).exists, 'Not registered')
    const pirate = clone(this.pirates(pirateKey).value)
    assert(pirate.alive, 'You are eliminated')

    const requiredMBR = this.getRequiredMBR('commitVote')
    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment receiver must be contract')
    assert(mbrPayment.amount >= requiredMBR, 'Insufficient MBR for vote commit')

    super.commitInRound(sessionID, state.currentRound, voteHash)
  }

  /**
   * Reveals a previously committed vote.
   * Updates the proposal vote count.
   */
  public revealVote(sessionID: uint64, vote: uint64, salt: bytes): void {
    assert(this.sessionExists(sessionID), 'Session does not exist')
    assert(vote === 0 || vote === 1, 'Vote must be 0 or 1')

    const state = clone(this.gameState(sessionID).value)
    const config = clone(this.gameSessions(sessionID).value)
    assert(Global.round > config.endCommitAt, 'Voting still open')
    assert(Global.round <= config.endRevealAt, 'Reveal deadline passed')
    assert(state.phase === 2 || state.phase === 3, 'Not in reveal phase')

    const pirateAddr = new Address(Txn.sender)
    const pirateKey = super.getPlayerKey(sessionID, pirateAddr)
    const pirate = clone(this.pirates(pirateKey).value)
    assert(pirate.alive, 'You are eliminated')

    super.revealInRound(sessionID, state.currentRound, vote, salt)

    const proposal = clone(this.proposals(sessionID).value)
    if (vote === 1) {
      proposal.votesFor += 1
    } else {
      proposal.votesAgainst += 1
    }
    this.proposals(sessionID).value = clone(proposal)

    if (state.phase === 2) {
      state.phase = 3
      this.gameState(sessionID).value = clone(state)
    }
  }

  /**
   * Executes the current round logic after the reveal phase.
   * Determines if the proposal passed or failed.
   * Eliminates the proposer if failed, or proceeds to next round/victory.
   */
  public executeRound(sessionID: uint64): void {
    ensureBudget(2000)
    assert(this.sessionExists(sessionID), 'Session does not exist')

    const state = clone(this.gameState(sessionID).value)
    const config = clone(this.gameSessions(sessionID).value)

    assert(state.phase === 3 || state.phase === 2, 'Not in execution phase')
    assert(Global.round > config.endRevealAt, 'Reveal phase not ended')

    const proposal = clone(this.proposals(sessionID).value)
    const totalVotes = state.alivePirates
    const votesFor = proposal.votesFor

    // Strict majority logic (or casting vote logic depending on preference)
    const passThreshold: uint64 = (totalVotes + 1) / 2
    const proposalPasses = votesFor >= passThreshold

    if (proposalPasses) {
      state.phase = 4
      this.gameState(sessionID).value = clone(state)
    } else {
      // Eliminate proposer
      this.eliminatePirate(sessionID, state.currentProposerIndex)
      state.alivePirates -= 1

      // Check "Last Man Standing"
      if (state.alivePirates === 1) {
        const survivorIndex = this.findNextAlivePirate(sessionID, 0, state.totalPirates)

        const totalSize: uint64 = state.totalPirates * 8
        const survivorOffset: uint64 = survivorIndex * 8
        const survivorShare = itob(state.pot)

        const before = bzero(survivorOffset)
        const afterOffset: uint64 = survivorOffset + 8
        const afterSize: uint64 = totalSize - afterOffset
        const after = bzero(afterSize)

        const distribution = before.concat(survivorShare).concat(after)

        this.proposals(sessionID).value = {
          proposer: survivorIndex,
          distribution: distribution,
          votesFor: 1,
          votesAgainst: 0
        }

        state.phase = 4 // Game Over
      } else {
        // Prepare next round
        state.currentProposerIndex = this.findNextAlivePirate(sessionID, state.currentProposerIndex + 1, state.totalPirates)
        state.currentRound += 1
        state.phase = 1

        const now = Global.round
        const newStartAt = now
        const newEndCommitAt: uint64 = newStartAt + state.commitDuration
        const newEndRevealAt: uint64 = newEndCommitAt + state.revealDuration

        config.startAt = newStartAt
        config.endCommitAt = newEndCommitAt
        config.endRevealAt = newEndRevealAt
      }

      this.gameSessions(sessionID).value = clone(config)
    }
    this.gameState(sessionID).value = clone(state)
  }

  /**
   * Allows a pirate to claim their share of the pot after the game ends.
   */
  public claimWinnings(sessionID: uint64): uint64 {
    assert(this.sessionExists(sessionID), 'Session does not exist')

    const state = clone(this.gameState(sessionID).value)
    assert(state.phase === 4, 'Game not finished')

    const pirateAddr = new Address(Txn.sender)
    const pirateKey = super.getPlayerKey(sessionID, pirateAddr)
    assert(this.pirates(pirateKey).exists, 'Not a pirate')

    const pirate = clone(this.pirates(pirateKey).value)
    assert(!pirate.claimed, 'Already claimed') // Anti-replay

    const winningProposal = clone(this.proposals(sessionID).value)

    const shareOffset: uint64 = pirate.seniorityIndex * 8
    const share = extractUint64(winningProposal.distribution, shareOffset)

    pirate.claimed = true
    this.pirates(pirateKey).value = clone(pirate)
    assert(share > 0, 'No winnings for you')
    
    if (share > 0) {
      itxn
        .payment({
          receiver: pirateAddr.native,
          amount: share,
          fee: 0,
        })
        .submit()
    }

    return share
  }

  /**
   * Helper to mark a pirate as dead.
   */
  private eliminatePirate(sessionID: uint64, seniorityIndex: uint64): void {
    const listBytes = this.pirateList(sessionID).value
    const offset: uint64 = seniorityIndex * 32
    const addrBytes = op.extract(listBytes, offset, 32)
    const pirateAddr = new Address(addrBytes)

    const pirateKey = super.getPlayerKey(sessionID, pirateAddr)
    const pirate = clone(this.pirates(pirateKey).value)
    pirate.alive = false
    this.pirates(pirateKey).value = clone(pirate)
  }

  /**
   * Helper to search for the next alive pirate starting from a specific index.
   * Wraps around the list if necessary.
   */
  private findNextAlivePirate(sessionID: uint64, startIndex: uint64, totalPirates: uint64): uint64 {
    const listBytes = this.pirateList(sessionID).value
    for (let i: uint64 = startIndex; i < totalPirates; i++) {
      const offset: uint64 = i * 32
      const addrBytes = op.extract(listBytes, offset, 32)
      const pirateAddr = new Address(addrBytes)
      const pirateKey = super.getPlayerKey(sessionID, pirateAddr)
      const pirate = clone(this.pirates(pirateKey).value)
      if (pirate.alive) return i
    }
    for (let i: uint64 = 0; i < startIndex; i++) {
      const offset: uint64 = i * 32
      const addrBytes = op.extract(listBytes, offset, 32)
      const pirateAddr = new Address(addrBytes)
      const pirateKey = super.getPlayerKey(sessionID, pirateAddr)
      const pirate = clone(this.pirates(pirateKey).value)
      if (pirate.alive) return i
    }
    assert(false, 'No alive pirate found')
  }

  /**
   * Calculates the MBR required for specific actions.
   */
  public getRequiredMBR(command: 'newGame' | 'join' | 'commitVote'): uint64 {
    if (command === 'newGame') {
      const maxPirates: uint64 = 20
      const gameStateMBR = super.getBoxMBR(11, 72)
      const pirateListMBR = super.getBoxMBR(11, maxPirates * 32)
      const proposalValueSize: uint64 = 8 + (maxPirates * 8) + 8 + 8
      const proposalsMBR = super.getBoxMBR(11, proposalValueSize)
      const parentMBR = super.getRequiredMBR('newGame')
      return gameStateMBR + pirateListMBR + proposalsMBR + parentMBR
    }
    else if (command === 'join') {
      // === Box: pirates ===
      // Key: 35 bytes
      // Value: Pirate struct
      //   - pirateAddress: 32 bytes
      //   - seniorityIndex: 8 bytes
      //   - alive: 1 byte
      //   - claimed: 1 byte (was 8 bytes when it was finalShare)
      //   Total: 42 bytes (was 49)
      return super.getBoxMBR(35, 42)
    }
    else if (command === 'commitVote') {
      return super.getRequiredMBR('join')
    }
    assert(false, 'Invalid command')
  }

  /**
   * Handles timeouts in various phases.
   * If registration stuck: refunds pirates.
   * If proposal stuck: eliminates the current proposer and moves to next round.
   */
  public timeOut(sessionID: uint64): void {
    ensureBudget(2000)
    assert(this.sessionExists(sessionID), 'Session does not exist')

    const state = clone(this.gameState(sessionID).value)
    const config = clone(this.gameSessions(sessionID).value)

    const canPlay = state.totalPirates >= 3

    if (state.phase === 0 && !canPlay) {
      assert(Global.round >= config.startAt, 'Registration still active')

      const pirateAddr = new Address(Txn.sender)
      const pirateKey = super.getPlayerKey(sessionID, pirateAddr)
      assert(this.pirates(pirateKey).exists, 'Not a registered pirate')
      const pirate = clone(this.pirates(pirateKey).value)
      assert(!pirate.claimed, 'Already refunded')

      pirate.claimed = true
      this.pirates(pirateKey).value = clone(pirate)

      itxn.payment({
        receiver: pirateAddr.native,
        amount: config.participation,
        fee: 0
      }).submit()
      return
    }

    if (state.phase === 1 || (state.phase === 0 && canPlay)) {

      assert(Global.round > config.endCommitAt, 'Proposal deadline not passed yet')

      this.eliminatePirate(sessionID, state.currentProposerIndex)
      state.alivePirates -= 1

      if (state.alivePirates === 1) {
        const survivorIndex = this.findNextAlivePirate(sessionID, 0, state.totalPirates)
        const totalSize: uint64 = state.totalPirates * 8
        const survivorOffset: uint64 = survivorIndex * 8
        const survivorShare = itob(state.pot)

        const before = bzero(survivorOffset)
        const afterOffset: uint64 = survivorOffset + 8
        const afterSize: uint64 = totalSize - afterOffset
        const after = bzero(afterSize)

        const distribution = before.concat(survivorShare).concat(after)

        this.proposals(sessionID).value = {
          proposer: survivorIndex,
          distribution: distribution,
          votesFor: 1,
          votesAgainst: 0
        }
        state.phase = 4 // Finished
      } else {
        state.currentProposerIndex = this.findNextAlivePirate(sessionID, state.currentProposerIndex + 1, state.totalPirates)
        state.currentRound += 1

        state.phase = 1

        const now = Global.round
        const newStartAt = now
        const newEndCommitAt: uint64 = newStartAt + state.commitDuration
        const newEndRevealAt: uint64 = newEndCommitAt + state.revealDuration

        config.startAt = newStartAt
        config.endCommitAt = newEndCommitAt
        config.endRevealAt = newEndRevealAt

        this.gameSessions(sessionID).value = clone(config)
      }

      this.gameState(sessionID).value = clone(state)
      return
    }

    assert(false, 'Nothing to unlock in this phase')
  }

}
