import { uint64 } from '@algorandfoundation/algorand-typescript'
import { Address, Bool, StaticArray, StaticBytes } from '@algorandfoundation/algorand-typescript/arc4'

/**Type for saving the game's data */
export type GameState = {
  players: StaticArray<Address, 15> //Players in game
  currentPlayerCount: uint64 //Number of players in game
  maxPlayers: uint64 //Max player for the specific game
  commits: StaticArray<StaticBytes<32>, 15> //Hash
  hasCommitted: StaticArray<Bool, 15>
  moves: StaticArray<StaticBytes<32>, 15> //The move
  hasRevealed: StaticArray<Bool, 15>
  balance: uint64 //Balance for the game
  participationFee: uint64 //Bet for the game
  deadline: uint64
  timerCommit: uint64
  timerReveal: uint64
  winner: Address
}
