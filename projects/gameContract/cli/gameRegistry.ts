import { IGameModule } from './interfaces';

/**
 * GameRegistry
 * * A central repository for all available games.
 * * It allows us to add new games without modifying the core UI code.
 */
export class GameRegistry {
  private static games: IGameModule[] = [];

  /**
   * Registers a new game module into the system.
   * @param game The game module implementation.
   */
  public static register(game: IGameModule) {
    this.games.push(game);
  }

  /**
   * Retrieves the list of all registered games.
   */
  public static getAll(): IGameModule[] {
    return this.games;
  }

  /**
   * Finds a specific game by its ID.
   */
  public static get(id: string): IGameModule | undefined {
    return this.games.find((g) => g.id === id);
  }
}
