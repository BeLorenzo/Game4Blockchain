/* eslint-disable @typescript-eslint/no-unused-vars */
import chalk from 'chalk';
import algosdk from 'algosdk';
import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Manages the local wallet configuration and funding.
 * Handles loading from environment variables or generating temporary accounts
 * for testing purposes.
 */
export class WalletManager {
  public algorand: AlgorandClient;
  public account: algosdk.Account | null = null;

  public constructor() {
    this.algorand = AlgorandClient.fromEnvironment();
  }

  /**
   * Initializes the primary wallet.
   * Priority:
   * 1. Loads 'MNEMONIC' from .env if available.
   * 2. Generates a fresh random account if no mnemonic is found.
   *
   * Sets the signer for the AlgorandClient instance.
   */
  public async initWallet() {
    console.log(chalk.cyan('🔄 Initializing Wallet...'));
    const envMnemonic = process.env.MNEMONIC;

    if (envMnemonic) {
      try {
        // Restore account from mnemonic
        this.account = algosdk.mnemonicToSecretKey(envMnemonic);
        console.log(
          chalk.green(`✅ Wallet loaded from .env: ${this.shortAddr(this.account.addr.toString())}`),
        );
      } catch (e) {
        console.log(chalk.red('❌ Invalid mnemonic in .env! Please check the file.'));
        process.exit(1);
      }
    } else {
      // Generate temporary account
      console.log(chalk.yellow('⚠️ No MNEMONIC found in .env. Generating temporary account...'));
      this.account = algosdk.generateAccount();
      console.log(
        chalk.green(`✅ Temporary wallet created: ${this.shortAddr(this.account.addr.toString())}`),
      );
    }

    // Register the account as the default signer for AlgoKit
    this.algorand.setSignerFromAccount(this.account);

    await this.ensureFunds();
    return this.account;
  }

  /**
   * Checks for funds and auto-dispenses ALGO if running on LocalNet.
   * Ensures the account has at least 10 ALGO.
   */
  public async ensureFunds() {
    if (!this.account) return;

    const info = await this.algorand.client.algod.accountInformation(this.account.addr).do();
    const balance = Number(info.amount);
    const minBalance = (10).algo().microAlgos;

    if (balance < minBalance) {
      if (await this.algorand.client.isLocalNet()) {
        console.log(chalk.gray('💰 Funding from LocalNet KMD...'));
        await this.algorand.account.ensureFundedFromEnvironment(this.account.addr, (10).algo());
      } else {
        console.log(chalk.red(`❌ Fondi insufficienti su Testnet per ${this.shortAddr(this.account.addr.toString())}`));
        console.log(chalk.yellow(`👉 Vai qui per ricaricare: https://bank.testnet.algorand.network/`));
      }
    }
    const updatedInfo = await this.algorand.client.algod.accountInformation(this.account.addr).do();
    console.log(chalk.gray(`💰 Current Balance: ${algosdk.microalgosToAlgos(Number(updatedInfo.amount))} ALGO`));
  }

  /**
   * Helper utility to format addresses (e.g., AAAA...ZZZZ).
   */
  public shortAddr(addr: string) {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 6)}`;
  }
}
