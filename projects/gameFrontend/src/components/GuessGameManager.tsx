/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { useEffect, useState } from 'react'
import { config } from '../config'
import { GuessGameClient } from '../contracts/GuessGame'

export const GuessGameManager = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [sessions, setSessions] = useState<any[]>([])

  // Parametri per la nuova sessione (Umano sceglie quanto puntare)
  const [newSessionFee, setNewSessionFee] = useState('1')

  const appId = config.games.guessGame.appId

  const getClient = () => {
    const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
    algorand.setDefaultSigner(transactionSigner)
    return new GuessGameClient({ algorand, appId })
  }

  const refreshSessions = async () => {
    if (appId === 0n) return
    try {
      const client = getClient()
      const sessionsMap = await client.state.box.gameSessions.getMap()
      const statsMap = await client.state.box.stats.getMap()

      const list = Array.from(sessionsMap.entries()).map(([id, conf]) => ({
        id: id.toString(),
        participation: (Number(conf.participation) / 1_000_000).toString(),
        players: statsMap.get(id)?.count.toString() || '0',
      }))
      setSessions(list.reverse())
    } catch (e) {
      console.log('In attesa di sessioni...')
    }
  }

  useEffect(() => {
    refreshSessions()
  }, [appId])

  // --- LOGICA CREAZIONE NUOVA SESSIONE ---
  const handleCreateSession = async () => {
    if (!activeAddress) return alert('Connetti il wallet!')
    setLoading(true)
    setStatus('Richiesta MBR al contratto...')

    try {
      const client = getClient()
      const algorand = AlgorandClient.defaultLocalNet() // O usa config per testnet

      // 1. Calcoliamo l'MBR necessario per la nuova Box della sessione
      const mbrReq = await client.send.getRequiredMbr({
        args: { command: 'newGame' },
        sender: activeAddress,
      })

      // 2. Prepariamo il pagamento MBR
      const params = await algorand.client.algod.getTransactionParams().do()
      const mbrTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: Number(mbrReq.return),
        suggestedParams: params,
      })

      // 3. Calcolo tempi (fase commit 5 min, fase reveal 5 min approssimativi)
      const round = (await algorand.client.algod.status().do())['lastRound']

      await client.send.createSession({
        sender: activeAddress,
        args: {
          config: {
            startAt: BigInt(round + 1n),
            endCommitAt: BigInt(round + 100n), // ~5 minuti su LocalNet
            endRevealAt: BigInt(round + 200n),
            participation: BigInt(parseFloat(newSessionFee) * 1_000_000),
          },
          mbrPayment: { txn: mbrTxn, signer: transactionSigner },
        },
      })

      setStatus('✅ Sessione creata con successo!')
      refreshSessions()
    } catch (e: any) {
      console.error(e)
      setStatus('❌ Errore creazione sessione')
    } finally {
      setLoading(false)
    }
  }

  // --- LOGICA PARTECIPAZIONE (JOIN) ---
  const handleJoin = async (sessionId: string, participationFee: string) => {
    if (!activeAddress) return alert('Connetti il wallet!')

    const choiceStr = prompt('Scegli un numero tra 0 e 100:')
    if (choiceStr === null || choiceStr === '') return
    const choice = BigInt(choiceStr)

    setLoading(true)
    setStatus('Generazione prova segreta...')

    try {
      const client = getClient()
      const algorand = AlgorandClient.defaultLocalNet()

      const salt = crypto.getRandomValues(new Uint8Array(32))
      const storageKey = `guess_${appId}_${sessionId}_${activeAddress}`
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          choice: choice.toString(),
          salt: Buffer.from(salt).toString('hex'),
        }),
      )

      const choiceBytes = algosdk.bigIntToBytes(choice, 8)
      const toHash = new Uint8Array([...choiceBytes, ...salt])
      const commit = new Uint8Array(await crypto.subtle.digest('SHA-256', toHash))

      const params = await algorand.client.algod.getTransactionParams().do()
      const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: client.appAddress,
        amount: Number(parseFloat(participationFee) * 1_000_000),
        suggestedParams: params,
      })

      await client.send.joinSession({
        sender: activeAddress,
        args: {
          sessionId: BigInt(sessionId),
          commit: commit,
          payment: { txn: payTxn, signer: transactionSigner },
        },
      })

      setStatus(`✅ Sei in gioco per la sessione #${sessionId}!`)
      refreshSessions()
    } catch (e: any) {
      console.error(e)
      setStatus('❌ Errore Join')
    } finally {
      setLoading(false)
    }
  }

  if (appId === 0n) return <div className="text-center p-4 text-xs opacity-50">Configura App ID...</div>

  return (
    <div className="flex flex-col gap-6">
      {/* SEZIONE CREAZIONE */}
      <div className="bg-primary/10 p-4 rounded-2xl border border-primary/20">
        <h3 className="text-[10px] font-bold uppercase tracking-widest mb-3 opacity-70">Crea una nuova sfida</h3>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              className="input input-bordered input-sm w-full pl-8"
              value={newSessionFee}
              onChange={(e) => setNewSessionFee(e.target.value)}
            />
            <span className="absolute left-3 top-1.5 text-xs opacity-40">Ⱥ</span>
          </div>
          <button onClick={handleCreateSession} disabled={loading} className="btn btn-primary btn-sm">
            {loading ? '...' : 'Crea'}
          </button>
        </div>
        <p className="text-[9px] mt-2 opacity-50 italic">* Dovrai depositare un piccolo MBR che ti verrà restituito.</p>
      </div>

      <div className="divider opacity-10 my-0">OR</div>

      {/* LISTA SESSIONI */}
      <div className="space-y-4">
        <div className="flex justify-between items-center px-1">
          <h3 className="text-[10px] font-bold uppercase tracking-widest opacity-50">Partecipa a una partita</h3>
          <button onClick={refreshSessions} className="btn btn-ghost btn-xs">
            🔄
          </button>
        </div>

        <div className="grid gap-2 max-h-64 overflow-y-auto pr-1">
          {sessions.length === 0 ? (
            <div className="text-center py-6 opacity-30 text-xs italic">Nessuna partita trovata</div>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="bg-white/5 p-3 rounded-xl flex justify-between items-center border border-white/5">
                <div>
                  <div className="text-xs font-bold"># {s.id}</div>
                  <div className="text-[10px] opacity-60">
                    {s.participation} ALGO • {s.players} Players
                  </div>
                </div>
                <button onClick={() => handleJoin(s.id, s.participation)} className="btn btn-secondary btn-xs px-4" disabled={loading}>
                  Join
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {status && <div className="p-2 bg-black/40 border border-white/10 rounded text-[10px] font-mono text-center">{status}</div>}
    </div>
  )
}
