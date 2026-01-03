/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Action definition for dynamic CLI menus
 */
export interface GameAction {
  name: string;      // Display name (e.g., "🚀 Deploy Contract")
  value: string;     // Method name to call (e.g., "deploy")
  separator?: boolean; // Optional separator before this action
}


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
   * Returns the list of available actions for this game.
   * The CLI will dynamically build the menu based on this.
   */
  getAvailableActions(): GameAction[];

  /**
   * Dynamic method dispatcher.
   * Each game must implement handlers for actions defined in getAvailableActions().
   */
  [key: string]: any;
}
