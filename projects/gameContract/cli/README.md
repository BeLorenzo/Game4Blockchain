# 🖥️ AlgoGame Interactive CLI

> Interfaccia da riga di comando per interagire con i giochi on-chain

Questo tool permette di:
* Deployare nuovi contratti come Admin.
* Simulare partite Multiplayer (Player 1 vs Player 2).
* Gestire automaticamente hash, salt e pagamenti MBR.

---

## 🚀 Quick Start

Assicurati di aver già eseguito l'installazione globale nella root del progetto.

### 1. Configura l'Identità (.env)
Nella cartella `projects/gameContract`, crea o modifica il file `.env`:

**Nota Importante:**
* **Con `.env`:** La CLI usa sempre lo stesso account. 
* **Senza `.env`:** La CLI genererà un **wallet random temporaneo** ogni volta che la avvii.
    * ✅ Perfetto per il **Player 2** o per test veloci sulla **LocalNet**.
    * ❌ Appena chiudi il terminale, l'account e i fondi sono persi.

Esempio di `.env`:
```ini
# Incolla qui la mnemonica se vuoi un account fisso.
# Se non crei questo file, userai un account random.
MNEMONIC="tua parola uno due ... venticinque"
````

### 2. Avvia la LocalNet

Se non è già attiva:

```bash
algokit localnet start
```

### 3\. Lancia il Gioco

Dalla cartella `projects/gameContract`:

```bash
npm run cli
```

## 🎮 Guida ai Comandi

### Fase 0: Deploy (Admin)

Se è la prima volta che giochi, il contratto non esiste sulla rete.

1.  Seleziona **`🚀 Deploy Nuovo Contratto`**.
2.  **Copia l'APP ID** che appare a schermo (es. `1005`). Ti servirà per tutte le fasi successive.

### Fase 1: Create Game 

Usa questa opzione per aprire un nuovo tavolo di gioco.

1.  Seleziona **`🆕 Crea Nuova Partita`**.
2.  Inserisci l'**App ID** del contratto.
3.  Imposta i parametri (costo, durata).
4.  La CLI restituirà un **SESSION ID** (es. `0`). 

### Fase 2: Join Game 

1.  Seleziona **`👋 Unisciti a Partita (Join)`**.
2.  Inserisci l'**App ID** del contratto.
3.  Inserisci il **SESSION ID** 
4.  Fai la tua mossa segreta.
5.  ⚠️ **IMPORTANTE:** La CLI ti mostrerà un **SALT SEGRETO**. Copialo\! Senza di esso non potrai dimostrare la tua mossa e vincere.

### Fase 3: Reveal

Dopo che è finita la fase di commit:

1.  Seleziona **`🔓 Rivela Mossa (Reveal)`**.
2.  Inserisci i dati richiesti (Session ID, Mossa, Salt).
3.  Il contratto verificherà la mossa.


