import { Contract } from '@algorandfoundation/algorand-typescript'

export class GameContract extends Contract {
  public hello(name: string): string {
    return `Hello, ${name}`
  }
}
