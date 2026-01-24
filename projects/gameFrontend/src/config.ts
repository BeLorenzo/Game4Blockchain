export const config = {
  // Configurazione Nodo
  algodConfig: {
    server: import.meta.env.VITE_ALGOD_SERVER || 'http://localhost',
    port: import.meta.env.VITE_ALGOD_PORT || 4001,
    token: import.meta.env.VITE_ALGOD_TOKEN || 'a'.repeat(64),
  },

  // Registro Giochi
  games: {
    guessGame: {
      appId: import.meta.env.VITE_GUESSGAME_APP_ID ? BigInt(import.meta.env.VITE_GUESSGAME_APP_ID) : 0n,
      name: 'Guess The Number',
      icon: '🧠',
    },
    rps: {
      appId: import.meta.env.VITE_RPS_APP_ID ? BigInt(import.meta.env.VITE_RPS_APP_ID) : 0n,
      name: 'Rock Paper Scissors',
      icon: '✂️',
    },
    // Sostituisce o affianca "Pirate" (decidi tu se tenere Pirate o no, qui l'ho lasciato per sicurezza)
    pirate: {
      appId: import.meta.env.VITE_PIRATE_APP_ID ? BigInt(import.meta.env.VITE_PIRATE_APP_ID) : 0n,
      name: 'Pirate Game',
      icon: '🏴‍☠️',
    },
    // NUOVO GIOCO AGGIUNTO
    weeklyGame: {
      appId: import.meta.env.VITE_WEEKLYGAME_APP_ID ? BigInt(import.meta.env.VITE_WEEKLYGAME_APP_ID) : 0n,
      name: 'Weekly Lottery',
      icon: '🎟️',
    },
    stagHunt: {
      appId: import.meta.env.VITE_STAGHUNT_APP_ID ? BigInt(import.meta.env.VITE_STAGHUNT_APP_ID) : 0n,
      name: 'Stag Hunt',
      icon: '🏹',
    },
  },
}
