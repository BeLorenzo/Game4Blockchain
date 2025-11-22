import type { bytes, uint64 } from '@algorandfoundation/algorand-typescript'
import {
  Account,
  assert,
  BoxMap,
  Bytes,
  clone,
  Global,
  gtxn,
  itxn,
  Txn,
  Uint64,
} from '@algorandfoundation/algorand-typescript'
import { bzero } from '@algorandfoundation/algorand-typescript/op'

import { GameContract, GameConfig } from '../abstract_contract2/contract.algo'
import { ALGORAND_ZERO_ADDRESS_STRING } from 'algosdk'
import { Address } from '@algorandfoundation/algorand-typescript/arc4'

interface SessionPlayers{
  p1: Address
  p2: Address
}

/**
 * Contratto concreto per il gioco Sasso-Carta-Forbice tra due giocatori
 * Estende un contratto astratto GameContract che gestisce la logica comune di sessione.
 */
export class RockPaperScissors extends GameContract {
  // Mappa: sessionID -> Array con i due giocatori
  sessionPlayers = BoxMap<uint64, SessionPlayers>({ keyPrefix: 'spl' })

  // Mappa: sessionID -> Booleano (0 o 1) per tracciare se il gioco è finito
  gameFinished = BoxMap<uint64, uint64>({ keyPrefix: 'gfn' })

  /**
   * Crea una nuova sessione di gioco
   */
  public createNewSession(config: GameConfig, mbrPayment: gtxn.PaymentTxn): uint64 {

    // Calcola MBR per le box aggiuntive (esempio: chiave 11 byte, value 64 e 8 byte)
    const playersMBR: uint64 = super.getBoxMBR(11, 64)
    const stateMBR: uint64 = super.getBoxMBR(11, 8)
    const totalMBR: uint64 = playersMBR + stateMBR

    // Delega al contratto astratto per creare la sessione principale
    const sessionID = super.createSession(config, mbrPayment, totalMBR)

    // Inizializza le strutture aggiuntive
    const zeroAddress = Global.zeroAddress
    this.sessionPlayers(sessionID).value = {
      p1: new Address(zeroAddress),
      p2: new Address(zeroAddress),
    }
    this.gameFinished(sessionID).value = 0
    return sessionID
  }

  /**
   * Unisce un giocatore alla sessione (massimo 2 giocatori)
   */
  public joinSession(
    sessionID: uint64,
    commit: bytes,
    payment: gtxn.PaymentTxn,
    mbrPayment: gtxn.PaymentTxn,
  ): void {
    assert(this.sessionExists(sessionID), 'Sessione non esistente')

    const players = clone(this.sessionPlayers(sessionID).value)
    const senderAddress = new Address(Txn.sender)
    const zeroAddress = new Address(Global.zeroAddress)

    assert(players.p1.native !== senderAddress.native && players.p2.native !== senderAddress.native, 'Giocatore già in sessione')

    // 1. Trova lo slot libero e aggiorna
    if (players.p1.native === zeroAddress.native) {
      players.p1 = senderAddress // Assegna il mittente allo slot P1
    } else if (players.p2.native === zeroAddress.native) {
      players.p2 = senderAddress // Assegna il mittente allo slot P2
    } else {
      assert(false, 'La sessione è piena (2 giocatori)')
    }

    // Join logica comune del contratto astratto
    super.joinSession(sessionID, commit, payment, mbrPayment, 0)

    this.sessionPlayers(sessionID).value = clone(players)  
}

/**
   * Rivela la mossa e, se entrambi hanno rivelato, determina il vincitore
   */
  public revealMove(sessionID: uint64, choice: uint64, salt: bytes): void {
    // 0 = sasso, 1 = carta, 2 = forbice
    assert(choice < Uint64(3), 'Scelta non valida: deve essere 0, 1 o 2')

if (this.gameFinished(sessionID).value) {
        return;
    }

    // Delego il controllo di commit/reveal al contratto astratto
    super.revealMove(sessionID, choice, salt)

    const players = clone(this.sessionPlayers(sessionID).value)

    // Solo se entrambi gli slot sono stati riempiti
    if (players.p1.native !== new Address(Global.zeroAddress).native && 
        players.p2.native !== new Address(Global.zeroAddress).native) {

      const key1 = super.getPlayerKey(sessionID, players.p1)
      const key2 = super.getPlayerKey(sessionID, players.p2)

      // Verifico se entrambi i commit sono stati rivelati (se le PlayerBox esistono)
      if (this.playerChoice(key1).exists && this.playerChoice(key2).exists) {
        this.determineWinner(sessionID)
      }
    }
  }

  /**
   * Determina il vincitore e distribuisce il premio
   */
  private determineWinner(sessionID: uint64): void {
    assert(!this.gameFinished(sessionID).value, "Premio già distribuito")
    const players = clone(this.sessionPlayers(sessionID).value)

    const choice1: uint64 = this.getPlayerChoice(sessionID, players.p1)
    const choice2: uint64 = this.getPlayerChoice(sessionID, players.p2)

    const balance: uint64 = this.getSessionBalance(sessionID)


    const ROCK = 0
    const PAPER = 1
    const SCISSORS = 2

    // Pareggio: dividi il premio
    if (choice1 === choice2) {
      const half : uint64 = balance / 2
      this.distributePrize(players.p1, half)
      this.distributePrize(players.p2, half)
    } else if (
      (choice1 === ROCK && choice2 === SCISSORS) || 
      (choice1 === PAPER && choice2 === ROCK) || 
      (choice1 === SCISSORS && choice2 === PAPER) 
    ) {
      this.distributePrize(players.p1, balance)
    } else {
      this.distributePrize(players.p2, balance)
    }

    // FIX 1: Segna il gioco come finito
    this.gameFinished(sessionID).value = 1
  }
  /**
   * Paga il premio a un giocatore tramite inner transaction
   */
  private distributePrize(winner: Address, amount: uint64): void {
    itxn
      .payment({
        receiver: winner.native,
        amount,
        fee: 0,
      })
      .submit()
  }
}