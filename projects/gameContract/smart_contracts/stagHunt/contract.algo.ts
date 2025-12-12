import {
  assert,
  BoxMap,
  bytes,
  clone,
  ensureBudget,
  Global,
  GlobalState,
  gtxn,
  itxn,
  Txn,
  uint64,
} from '@algorandfoundation/algorand-typescript'
import { Address } from '@algorandfoundation/algorand-typescript/arc4'
import { GameConfig, GameContract } from '../abstract_contract/contract.algo'

/**
 * Statistics for a specific session.
 * Tracks player moves, resolution status, and financial outcomes.
 */
interface StagHuntStats {
  stags: uint64          // Count of players who chose Stag
  hares: uint64          // Count of players who chose Hare
  resolved: boolean      // True if the outcome has been calculated
  successful: boolean    // True if Stags won (Threshold met)
  rewardPerStag: uint64  // Calculated payout per Stag
}

/**
 * Implementation of the "Stag Hunt" (Assurance Game) with Global Jackpot.
 * * Game Mechanics:
 * - Players deposit a participation fee.
 * - Choice 0 (Hare): Low risk. Gets a partial refund (defined by hareRefundPercent).
 * - Choice 1 (Stag): High risk. Needs coordination.
 * * Win Condition:
 * - If % of Stags >= stagThresholdPercent: Stags share the pot + Global Jackpot.
 * - If % of Stags < stagThresholdPercent: Stags lose everything. Pot goes to Global Jackpot.
 */
export class StagHunt extends GameContract {

  /**
   * Percentage of the deposit refunded to Hares (Default: 80%).
   * This creates the "Safety" incentive.
   * stored in Global State to allow Admin updates.
   */
  hareRefundPercent = GlobalState<uint64>({ initialValue: 80 })

  /**
   * Percentage of total players required to choose Stag for a win (Default: 60%).
   * This creates the "Coordination" difficulty.
   * stored in Global State to allow Admin updates.
   */
  stagThresholdPercent = GlobalState<uint64>({ initialValue: 60 })

  /**
   * Global Jackpot: Accumulates funds from ALL failed sessions.
   * This persistent pot increases the incentive for Stags in future games.
   */
  globalJackpot = GlobalState<uint64>({ initialValue: 0 })

  /**
   * Session-specific statistics.
   * Key: SessionID
   */
  stats = BoxMap<uint64, StagHuntStats>({ keyPrefix: 'sh' })

  /**
   * Admin method to update game rules dynamically.
   * Only the contract creator can call this.
   * @param newRefund New refund percentage for Hares (0-100).
   * @param newThreshold New threshold percentage for Stags (0-100).
   */
  public updateGameRules(newRefund: uint64, newThreshold: uint64): void {
    assert(Txn.sender === Global.creatorAddress, 'Only creator can update rules')
    assert(newRefund <= 100, 'Refund % must be <= 100')
    assert(newThreshold <= 100, 'Threshold % must be <= 100')
    
    this.hareRefundPercent.value = newRefund
    this.stagThresholdPercent.value = newThreshold
  }

  /**
   * Creates a new game session.
   * Enforces a minimum participation fee to avoid dust spam.
   */
  public createSession(config: GameConfig, mbrPayment: gtxn.PaymentTxn): uint64 {
    assert(config.participation >= 1_000_000, 'Minimum participation is 1 ALGO')

    const requiredMBR = this.getRequiredMBR('newGame')
    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment receiver must be contract')
    assert(mbrPayment.amount >= requiredMBR, 'Insufficient MBR')

    const sessionID = super.create(config)

    this.stats(sessionID).value = {
      stags: 0,
      hares: 0,
      resolved: false,
      successful: false,
      rewardPerStag: 0
    }

    return sessionID
  }

  /**
   * Allows a player to join the session.
   */
  public joinSession(sessionID: uint64, commit: bytes, payment: gtxn.PaymentTxn): void {
    super.join(sessionID, commit, payment)
  }

  /**
   * Reveals a player's move.
   * Updates the live counts of Stags and Hares.
   * @param choice 0 for Hare, 1 for Stag.
   */
  public revealMove(sessionID: uint64, choice: uint64, salt: bytes): void {
    assert(choice === 0 || choice === 1, 'Choice must be 0 (Hare) or 1 (Stag)')
    super.reveal(sessionID, choice, salt)

    const stats = clone(this.stats(sessionID).value)
    if (choice === 1) stats.stags += 1
    else stats.hares += 1
    
    this.stats(sessionID).value = clone(stats)
  }

  /**
   * Resolves the session outcome based on the threshold.
   * Handles financial logic: refunds, jackpot accumulation, or payout calculation.
   * Must be called once after the reveal phase ends.
   */
  public resolveSession(sessionID: uint64): void {
    // Ensure sufficient opcode budget for math and state updates
    ensureBudget(2000)
    assert(this.sessionExists(sessionID), 'Session does not exist')
    
    const config = clone(this.gameSessions(sessionID).value)
    assert(Global.round > config.endRevealAt, 'Reveal phase not ended')

    const stats = clone(this.stats(sessionID).value)
    if (stats.resolved) return // Idempotency check

    const currentThresholdPct = this.stagThresholdPercent.value
    const currentRefundPct = this.hareRefundPercent.value

    const totalRevealed: uint64 = stats.stags + stats.hares
    const sessionBalance = this.getSessionBalance(sessionID)

    // Edge Case: No one revealed. Treat as total failure.
    // All funds (ghost players) go to the Global Jackpot.
    if (totalRevealed === 0) {
        stats.resolved = true
        stats.successful = false
        this.globalJackpot.value += sessionBalance
        this.stats(sessionID).value = clone(stats)
        return
    }

    // 1. Check Threshold
    // Logic: (Stags * 100) >= (Total * Threshold%)
    const thresholdMet = (stats.stags * 100) >= (totalRevealed * currentThresholdPct)

    // 2. Calculate Liabilities (Hare Refunds)
    const hareRefundUnit: uint64 = (config.participation * currentRefundPct) / 100
    const totalHareRefunds: uint64 = stats.hares * hareRefundUnit

    assert(sessionBalance >= totalHareRefunds, 'Critical: Insolvency')

    // 3. Calculate Net Pot
    // This includes Stag deposits + Hare fees + Ghost player deposits
    const netSessionPot: uint64 = sessionBalance - totalHareRefunds

    if (thresholdMet && stats.stags > 0) {
        // --- SUCCESS CASE (Coordination Achieved) ---
        const jackpotAmount = this.globalJackpot.value
        const totalDistributable: uint64 = netSessionPot + jackpotAmount

        const share: uint64 = totalDistributable / stats.stags
        const remainder: uint64 = totalDistributable % stats.stags

        stats.successful = true
        stats.rewardPerStag = share

        // Reset Jackpot (keep only the indivisible dust)
        this.globalJackpot.value = remainder

    } else {
        // --- FAILURE CASE (Coordination Failed) ---
        // Stags lose everything. The entire Net Pot feeds the Global Jackpot.
        this.globalJackpot.value += netSessionPot
        
        stats.successful = false
        stats.rewardPerStag = 0
    }

    stats.resolved = true
    this.stats(sessionID).value = clone(stats)
  }

  /**
   * Allows players to pull their winnings or refunds.
   */
  public claimWinnings(sessionID: uint64): uint64 {
    assert(this.sessionExists(sessionID), 'Session does not exist')
    
    const config = clone(this.gameSessions(sessionID).value)
    const playerAddr = new Address(Txn.sender)
    const playerKey = this.getPlayerKey(sessionID, playerAddr)
    
    assert(this.playerChoice(playerKey).exists, 'Player has not revealed or already claimed')
    
    const stats = clone(this.stats(sessionID).value)
    assert(stats.resolved, 'Game not resolved')

    const choice = this.playerChoice(playerKey).value
    let payout: uint64 = 0
    const currentRefundPct = this.hareRefundPercent.value

    if (choice === 0) {
        // HARE: Gets the safety refund
        payout = (config.participation * currentRefundPct) / 100
    } else {
        // STAG: Gets the reward if successful, 0 otherwise
        if (stats.successful) {
            payout = stats.rewardPerStag
        } else {
            payout = 0
        }
    }

    // Cleanup state (Anti-Replay)
    this.playerChoice(playerKey).delete()

    if (payout > 0) {
        itxn.payment({
            receiver: playerAddr.native,
            amount: payout,
            fee: 0
        }).submit()
    }

    return payout
  }

  /**
   * Calculates the MBR for session creation.
   * Allocates space for the Stats struct.
   */
  public getRequiredMBR(command: 'newGame' | 'join'): uint64 {
    if (command === 'newGame') {
      // Box Stats: Key(8) + Struct(32 bytes for alignment)
      const statsMBR = this.getBoxMBR(8, 32)
      return statsMBR + super.getRequiredMBR('newGame')
    }
    return super.getRequiredMBR(command)
  }
}
