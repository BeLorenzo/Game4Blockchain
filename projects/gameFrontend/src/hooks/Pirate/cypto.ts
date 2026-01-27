import algosdk from 'algosdk'

/**
 * Converte l'array di distribuzione (numeri) in un Uint8Array (BigEndian Uint64)
 * Richiesto da proposeDistribution.
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

/**
 * Genera l'hash per il commit del voto.
 * Logic: SHA256( Uint64(vote) + salt )
 */
export const createVoteCommit = async (vote: 0 | 1): Promise<{ hash: Uint8Array, salt: Uint8Array }> => {
  // 1. Genera Salt Casuale (32 bytes)
  const salt = new Uint8Array(32)
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(salt)
  } else {
    // Fallback per ambienti non-browser (test)
    for(let i=0; i<32; i++) salt[i] = Math.floor(Math.random() * 256)
  }

  // 2. Codifica il voto come Uint64 (8 bytes)
  const voteBytes = algosdk.bigIntToBytes(vote, 8)

  // 3. Concatena Voto + Salt
  const combined = new Uint8Array(voteBytes.length + salt.length)
  combined.set(voteBytes)
  combined.set(salt, voteBytes.length)

  // 4. FIX: Hash SHA256 Asincrono (Web Crypto API)
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined)
  const hash = new Uint8Array(hashBuffer)

  return { hash, salt }
}