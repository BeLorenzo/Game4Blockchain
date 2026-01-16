/* eslint-disable @typescript-eslint/no-explicit-any */
// src/components/GuessGameManager.tsx
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useWallet } from '@txnlab/use-wallet-react'
import { useEffect, useState } from 'react'
import { config } from '../config'
import { GuessGameClient } from '../contracts/GuessGame'

export const GuessGameManager = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [sessions, setSessions] = useState<any[]>([])
  const [mbrs, setMbrs] = useState({ create: '0', join: '0' })
  const [currentRound, setCurrentRound] = useState<number>(0)

  const appId = config.games.guessGame.appId

  const getClient = () => {
    const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
    algorand.setDefaultSigner(transactionSigner)
    return new GuessGameClient({ algorand, appId })
  }

  const fetchMbrs = async () => {
    try {
      const client = getClient()
      const createMbr = await client.send.getRequiredMbr({ args: { command: 'newGame' }, sender: activeAddress || client.appAddress })
      const joinMbr = await client.send.getRequiredMbr({ args: { command: 'joinGame' }, sender: activeAddress || client.appAddress })
      setMbrs({
        create: (Number(createMbr.return) / 1_000_000).toString(),
        join: (Number(joinMbr.return) / 1_000_000).toString(),
      })
    } catch (e) {
      console.error(e)
    }
  }

  const refreshSessions = async () => {
    if (appId === 0n) return
    const client = getClient()
    const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
    const statusInfo = await algorand.client.algod.status().do()
    const now = Number(statusInfo['lastRound'])
    setCurrentRound(now)

    try {
      const sessionsMap = await client.state.box.gameSessions.getMap()
      const statsMap = await client.state.box.stats.getMap()

      const list = Array.from(sessionsMap.entries()).map(([id, conf]) => {
        const stats = statsMap.get(id)
        const start = Number(conf.startAt)
        const commitEnd = Number(conf.endCommitAt)
        const revealEnd = Number(conf.endRevealAt)

        let phase = 'TERMINATA'
        let phaseColor = 'badge-ghost'

        if (now < start) {
          phase = 'ATTESA'
          phaseColor = 'badge-warning'
        } else if (now < commitEnd) {
          phase = 'COMMIT'
          phaseColor = 'badge-primary'
        } else if (now < revealEnd) {
          phase = 'REVEAL'
          phaseColor = 'badge-secondary'
        }

        return {
          id: id.toString(),
          fee: (Number(conf.participation) / 1_000_000).toString(),
          players: stats ? stats.count.toString() : '0',
          phase,
          phaseColor,
          isEnded: now >= revealEnd,
        }
      })

      // Punto 1: Ordine crescente per ID
      setSessions(list.sort((a, b) => Number(a.id) - Number(b.id)))
    } catch (e) {
      console.log('Caricamento...')
    }
  }

  useEffect(() => {
    refreshSessions()
    fetchMbrs()
    const timer = setInterval(refreshSessions, 5000)
    return () => clearInterval(timer)
  }, [appId, activeAddress])

  // Form State
  const [form, setForm] = useState({ fee: '1', commit: '50', reveal: '50' })

  return (
    <div className="flex flex-col gap-6">
      {/* 3. Form Creazione Migliorato */}
      <div className="bg-base-300 p-4 rounded-xl space-y-4 border border-white/5">
        <h3 className="text-[10px] font-bold uppercase opacity-50 flex justify-between">
          <span>Configura Nuova Sessione</span>
          <span className="text-primary">MBR: {mbrs.create} ALGO</span>
        </h3>

        <div className="grid grid-cols-1 gap-3">
          <div className="form-control">
            <label className="label py-1">
              <span className="label-text text-[10px] uppercase">Quota Ingresso (ALGO)</span>
            </label>
            <input
              type="number"
              className="input input-sm input-bordered"
              value={form.fee}
              onChange={(e) => setForm({ ...form, fee: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text text-[10px] uppercase">Durata Commit (Round)</span>
              </label>
              <input
                type="number"
                className="input input-sm input-bordered"
                value={form.commit}
                onChange={(e) => setForm({ ...form, commit: e.target.value })}
              />
            </div>
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text text-[10px] uppercase">Durata Reveal (Round)</span>
              </label>
              <input
                type="number"
                className="input input-sm input-bordered"
                value={form.reveal}
                onChange={(e) => setForm({ ...form, reveal: e.target.value })}
              />
            </div>
          </div>
        </div>
        <button className="btn btn-primary btn-sm w-full font-bold uppercase">Inizializza Partita</button>
      </div>

      {/* 1 & 5. Lista Sessioni */}
      <div className="space-y-4">
        <div className="tabs tabs-boxed bg-transparent gap-2">
          <button className="tab tab-sm tab-active">Attive</button>
          <button className="tab tab-sm">Storico</button>
        </div>

        <div className="grid gap-3">
          {sessions
            .filter((s) => !s.isEnded)
            .map((s) => (
              <div key={s.id} className="bg-base-200 p-4 rounded-2xl border border-white/10 hover:border-primary/30 transition-all">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg font-black font-mono">#{s.id}</span>
                      <div className={`badge ${s.phaseColor} badge-xs font-bold p-2`}>{s.phase}</div>
                    </div>
                    <div className="text-[10px] font-mono opacity-50">
                      ENTRY: {s.fee} ALGO + {mbrs.join} MBR
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-secondary">{s.players}</div>
                    <div className="text-[8px] uppercase font-bold opacity-40">Giocatori</div>
                  </div>
                </div>

                {/* Qui potremmo mappare gli indirizzi se avessimo la Box Participants */}
                <div className="bg-black/20 rounded-lg p-2 mb-3">
                  <div className="text-[8px] uppercase opacity-40 mb-1">Partecipanti</div>
                  <div className="text-[9px] font-mono truncate opacity-80">G4S2...XT3S (Esempio)</div>
                </div>

                <button className="btn btn-secondary btn-sm w-full font-bold uppercase">Partecipa</button>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
