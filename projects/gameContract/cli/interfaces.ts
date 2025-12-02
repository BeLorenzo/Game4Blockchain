import { WalletManager } from './walletManager';

/**
 * IGameModule
 * Defines the standard structure that every game plugin must implement.
 * This ensures the main CLI can interact with any game (RPS, Lottery, etc.)
 * without knowing its internal logic.
 */
export interface IGameModule {
  /** Unique identifier for the game  */
  id: string;
  
  /** The name displayed in the CLI menu */
  name: string;


  /**
   * Deploaya una NUOVA istanza dello Smart Contract sulla rete.
   * Restituisce il nuovo App ID.
   */
  deploy(wallet: WalletManager): Promise<void>; // <--- NUOVO METODO

  /**
   * Logic to create a new session of this game.
   * @param wallet The user's wallet manager to sign transactions.
   */
  create(wallet: WalletManager): Promise<void>;

  /**
   * Logic to join an existing session and committing.
   * @param wallet The user's wallet manager.
   */
  join(wallet: WalletManager): Promise<void>;

    /**
   * Logic to reveal the move.
   * @param wallet The user's wallet manager.
   */
  reveal(wallet: WalletManager): Promise<void>;

  /**
   * Logic to view the status of a game.
   * @param wallet The user's wallet manager.
   */
  getStatus(wallet: WalletManager): Promise<void>;
}
