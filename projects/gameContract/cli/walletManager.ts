/* eslint-disable @typescript-eslint/no-unused-vars */
import chalk from 'chalk';
import algosdk from 'algosdk';
import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import dotenv from 'dotenv';

dotenv.config();


export class WalletManager {
  public algorand: AlgorandClient;
  public account: algosdk.Account | null = null;

  public constructor() {
    this.algorand = AlgorandClient.fromEnvironment();
  }

  public async initWallet() {
    console.log(chalk.cyan('🔄 Initializing Wallet...'));
    const envMnemonic = process.env.MNEMONIC;
    if (envMnemonic) {
      try {
        this.account = algosdk.mnemonicToSecretKey(envMnemonic);
        console.log(
          chalk.green(`✅ Wallet caricato da .env: ${this.shortAddr(this.account.addr.toString())}`),
        );
      } catch (e) {
        console.log(chalk.red('❌ Mnemonica nel .env non valida! Controlla il file.'));
        process.exit(1); 
      }
    } else {
      console.log(chalk.yellow('⚠️ Nessuna MNEMONIC trovata nel .env. Generazione account temporaneo...'));
      this.account = algosdk.generateAccount();
      console.log(
        chalk.green(`✅ Wallet temporaneo creato: ${this.shortAddr(this.account.addr.toString())}`),
      );
    }

    this.algorand.setSignerFromAccount(this.account);

    await this.ensureFunds();
    return this.account;
  }

  public async ensureFunds() {
    if (!this.account) return;

    console.log(chalk.gray('💰 Checking funds...'));

    // Auto-fund from KMD if LocalNet
    await this.algorand.account.ensureFundedFromEnvironment(
      this.account.addr, 
      (10).algo(), 
    );

    const info = await this.algorand.client.algod.accountInformation(this.account.addr).do();
    console.log(chalk.gray(`💰 Current Balance: ${algosdk.microalgosToAlgos(Number(info.amount))} ALGO`));
    console.log('\n')
  } 

  public shortAddr(addr: string) {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 6)}`;
  }
}
