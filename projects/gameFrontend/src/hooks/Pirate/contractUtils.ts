import algosdk from 'algosdk'
import { createCommit } from '../gameUtils'

/**
 * Converte l'array di distribuzione (numeri) in un Uint8Array (BigEndian Uint64)
 */
export const encodeDistribution = (distribution: number[]): Uint8Array => {
  const buffer = new Uint8Array(distribution.length * 8)
  const view = new DataView(buffer.buffer)
  
  distribution.forEach((amount, index) => {
    view.setBigUint64(index * 8, BigInt(amount), false) 
  })
  
  return buffer
}

/**
 * Genera la chiave per leggere i Box specifici di un pirata
 */
export const getPirateBoxKey = async (sessionId: number, address: string): Promise<Uint8Array> => {
  const sessionBytes = algosdk.bigIntToBytes(sessionId, 8)
  const addressBytes = algosdk.decodeAddress(address).publicKey
  
  const combined = new Uint8Array(sessionBytes.length + addressBytes.length)
  combined.set(sessionBytes)
  combined.set(addressBytes, sessionBytes.length)
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

/**
 * Wrapper per creare il commit del voto usando la util esistente.
 */
export const createVoteCommit = async (vote: 0 | 1) => {
  return await createCommit(vote)
}

export const decodeDistribution = (data: Uint8Array | undefined): number[] => {
  if (!data) return []
  const result: number[] = []
  
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  
  for (let i = 0; i < data.byteLength; i += 8) {
    // Leggiamo 8 byte alla volta
    const valMicro = view.getBigUint64(i, false) 
    result.push(Number(valMicro) / 1e6)
  }
  return result
}