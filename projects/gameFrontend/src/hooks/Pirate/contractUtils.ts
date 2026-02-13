import algosdk from 'algosdk'
import { createCommit } from '../gameUtils'

/**
 * Encodes a distribution array of microAlgo amounts into a Uint8Array format.
 * 
 * Converts an array of numbers (representing microAlgo amounts) into a binary format
 * where each amount is stored as an 8-byte big-endian unsigned 64-bit integer.
 * This format is required by Algorand smart contracts for storing numeric arrays.
 * @example
 * // Encode distribution of 1 ALGO (1,000,000 microAlgos) and 0.5 ALGO (500,000 microAlgos)
 * const encoded = encodeDistribution([1000000, 500000])
 * // Returns Uint8Array of length 16 (2 amounts × 8 bytes each)
 */
export const encodeDistribution = (distribution: number[]): Uint8Array => {
  // Each amount requires 8 bytes (64 bits)
  const buffer = new Uint8Array(distribution.length * 8)
  const view = new DataView(buffer.buffer)
  
  // Write each amount as 8-byte big-endian unsigned integer
  distribution.forEach((amount, index) => {
    view.setBigUint64(index * 8, BigInt(amount), false) // false = big-endian
  })
  
  return buffer
}

/**
 * Generates a unique box key for accessing a specific pirate's data in contract storage.
 * 
 * In Algorand, boxes are named using 32-byte keys. This function creates a deterministic
 * key by concatenating the session ID with the pirate's address and hashing the result.
 * @example
 * // Generate key for session 123 and address "ALGORAND_ADDRESS"
 * const key = await getPirateBoxKey(123, "ALGORAND_ADDRESS")
 * // Returns 32-byte Uint8Array hash
 */
export const getPirateBoxKey = async (sessionId: number, address: string): Promise<Uint8Array> => {
  // Convert session ID to 8-byte big-endian representation
  const sessionBytes = algosdk.bigIntToBytes(sessionId, 8)
  
  // Decode Algorand address to 32-byte public key
  const addressBytes = algosdk.decodeAddress(address).publicKey
  
  // Concatenate session ID bytes and address bytes
  const combined = new Uint8Array(sessionBytes.length + addressBytes.length)
  combined.set(sessionBytes)
  combined.set(addressBytes, sessionBytes.length)
  
  // Hash the combined bytes to create a 32-byte box key
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined)
  return new Uint8Array(hashBuffer)
}

/**
 * Decodes a raw pirate list byte array into an array of Algorand addresses.
 * 
 * The contract stores pirate addresses as a concatenated sequence of 32-byte public keys.
 * This function splits the raw byte array into 32-byte chunks and converts each to
 * the standard Algorand address string format.
 * @example
 * // Decode a 64-byte buffer containing 2 pirates
 * const addresses = decodePirateList(rawBytes)
 * // Returns ["ALGORAND_ADDRESS_1", "ALGORAND_ADDRESS_2"]
 */
export const decodePirateList = (rawList: Uint8Array | undefined): string[] => {
  if (!rawList) return []
  const addresses: string[] = []
  
  // Each Algorand address is encoded as 32 bytes in raw format
  for (let i = 0; i < rawList.length; i += 32) {
    const chunk = rawList.slice(i, i + 32)
    if (chunk.length === 32) {
      // Convert 32-byte public key to standard Algorand address string
      addresses.push(algosdk.encodeAddress(chunk))
    }
  }
  return addresses
}

/**
 * Creates a vote commitment for the commit/reveal voting pattern.
 * 
 * Wrapper function that uses the existing `createCommit` utility to generate
 * a cryptographic commitment for a vote. The commitment hides the vote until
 * the reveal phase, preventing vote manipulation.
 * @example
 * // Create commitment for a "For" vote
 * const { commitHash, salt } = await createVoteCommit(1)
 * // Send commitHash to contract, store salt locally
 */
export const createVoteCommit = async (vote: 0 | 1) => {
  return await createCommit(vote)
}

/**
 * Decodes a distribution byte array into an array of ALGO amounts.
 * 
 * Converts a Uint8Array of 8-byte big-endian unsigned 64-bit integers (microAlgos)
 * back into an array of ALGO amounts (with 6 decimal places).
 * This is the inverse operation of `encodeDistribution`.
 * @example
 * // Decode a 16-byte buffer containing two 8-byte values
 * const amounts = decodeDistribution(encodedData)
 * // Returns [1.0, 0.5] for 1,000,000 and 500,000 microAlgos
 */
export const decodeDistribution = (data: Uint8Array | undefined): number[] => {
  if (!data) return []
  const result: number[] = []
  
  // Use DataView for reading 64-bit integers from the byte array
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  
  // Read 8 bytes at a time (64-bit chunks)
  for (let i = 0; i < data.byteLength; i += 8) {
    // Read 8 bytes as a big-endian unsigned 64-bit integer
    const valMicro = view.getBigUint64(i, false) // false = big-endian
    
    // Convert from microAlgos to ALGO (1 ALGO = 1,000,000 microAlgos)
    result.push(Number(valMicro) / 1e6)
  }
  return result
}