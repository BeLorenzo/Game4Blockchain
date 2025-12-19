import { Agent } from '../Agent'

export interface IGameAdapter {
  deploy(admin: Agent): Promise<bigint>

  startSession(dealer: Agent): Promise<bigint>

  play_Commit(agents: Agent[], sessionId: bigint, roundIndex?: number): Promise<void>

  play_Reveal(agents: Agent[], sessionId: bigint, roundIndex?: number): Promise<void>

  resolve(dealer: Agent, sessionId: bigint, roundIndex?: number): Promise<void>

  play_Claim(agents: Agent[], sessionId: bigint, roundIndex?: number): Promise<void>
}
