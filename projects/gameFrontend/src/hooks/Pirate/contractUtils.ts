import algosdk from 'algosdk'
import { createCommit } from '../gameUtils'

// ============================================================================
// PIRATE SPECIFIC ENCODING (Mancante nel tuo file)
// ============================================================================

/**
 * Converte l'array di distribuzione (numeri) in un Uint8Array (BigEndian Uint64)
 * CRUCIALE: Il contratto vuole un byte array unico, non un array di uint64.
 */
export const encodeDistribution = (distribution: number[]): Uint8Array => {
  const buffer = new Uint8Array(distribution.length * 8)
  const view = new DataView(buffer.buffer)
  
  distribution.forEach((amount, index) => {
    // Scriviamo BigInt a 64bit in Big Endian
    view.setBigUint64(index * 8, BigInt(amount), false) 
  })
  
  return buffer
}

// ============================================================================
// BOX DECODING HELPERS
// ============================================================================

/**
 * Genera la chiave per leggere i Box specifici di un pirata
 * Logic: SHA256(itob(sessionID) + decodingAddress(playerAddr))
 */
export const getPirateBoxKey = async (sessionId: number, address: string): Promise<Uint8Array> => {
  const sessionBytes = algosdk.bigIntToBytes(sessionId, 8)
  const addressBytes = algosdk.decodeAddress(address).publicKey
  
  const combined = new Uint8Array(sessionBytes.length + addressBytes.length)
  combined.set(sessionBytes)
  combined.set(addressBytes, sessionBytes.length)
  
  // Utilizziamo l'API nativa del browser (async)
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined)
  return new Uint8Array(hashBuffer)
}

/**
 * Converte il blob di byte della PirateList in array di stringhe indirizzi
 */
export const decodePirateList = (rawList: Uint8Array | undefined): string[] => {
  if (!rawList) return []
  const addresses: string[] = []
  // Ogni indirizzo Algorand è lungo 32 byte in raw
  for (let i = 0; i < rawList.length; i += 32) {
    const chunk = rawList.slice(i, i + 32)
    if (chunk.length === 32) {
      addresses.push(algosdk.encodeAddress(chunk))
    }
  }
  return addresses
}

// ============================================================================
// EXPORT WRAPPERS
// ============================================================================

/**
 * Wrapper per creare il commit del voto usando la tua util esistente.
 * Il voto è 0 o 1, quindi value: number va benissimo.
 */
export const createVoteCommit = async (vote: 0 | 1) => {
  // Riutilizziamo la tua funzione createCommit esistente
  // Nota: la tua funzione è async, quindi dobbiamo attenderla
  return await createCommit(vote)
}
