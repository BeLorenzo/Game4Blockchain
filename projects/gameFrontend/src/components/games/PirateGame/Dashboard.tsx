/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useContext, createContext, useEffect, useMemo } from 'react'
import { usePirateGame, PirateSession } from '../../../hooks/usePirateGame'
import { GenericGameDashboard } from '../../common/GenericGameDashboard'
import { GenericSessionItem } from '../../common/GenericSessionItem'

const PirateActionsContext = createContext<any>(null)

/**
 * PirateSessionItem
 * Definito FUORI dalla Dashboard per garantire stabilità referenziale (Anti-Flicker).
 */
const PirateSessionItem = ({ session, loading, onReveal, onClaim, onJoin }: any) => {
  const ps = session as PirateSession
  const { proposeDistribution, commitVote, executeRound } = useContext(PirateActionsContext)

  const [shares, setShares] = useState<string[]>(Array(ps.totalPirates).fill(''))

  useEffect(() => {
      setShares(prev => {
          if (prev.length === ps.totalPirates) return prev
          const newArr = Array(ps.totalPirates).fill('')
          prev.forEach((v, i) => { if(i < newArr.length) newArr[i] = v })
          return newArr
      })
  }, [ps.totalPirates])

  // Mascheramento per nascondere il box generico "Your Pick"
  // Lo mostriamo solo in fase di REVEAL o ENDED
  const showGenericPick = ps.phase === 'REVEAL' || ps.phase === 'ENDED'
  const displaySession = {
      ...ps,
      hasPlayed: showGenericPick ? ps.hasPlayed : false,
      myMove: showGenericPick ? ps.myMove : null
  }

  const handlePropose = (e: React.MouseEvent) => {
    e.stopPropagation()
    const safePot = ps.totalPot || 0
    const numericShares = shares.map(s => Math.floor(parseFloat(s || '0') * 1_000_000))
    const sum = numericShares.reduce((a, b) => a + b, 0)
    const potMicro = Math.round(safePot * 1_000_000)

    if (Math.abs(sum - potMicro) > 1) {
        alert(`Total mismatch!\nPot: ${(potMicro/1e6).toFixed(6)} A\nYours: ${(sum/1e6).toFixed(6)} A`)
        return
    }
    if (proposeDistribution) proposeDistribution(ps.id, numericShares)
  }

  const renderPlayerStatus = () => {
    if (ps.hasRegistered && (!ps.isAlive || ps.claimResult?.isEliminated)) {
        return (
            <div className="p-3 bg-red-900/20 border border-red-500/40 rounded-xl flex items-center gap-3 mb-4">
                <span className="text-2xl">💀</span>
                <div><div className="font-black text-red-500 text-xs uppercase">ELIMINATED</div><div className="text-[10px] text-red-300">Thrown overboard</div></div>
            </div>
        )
    }
    if (ps.hasRegistered) {
        const isCaptain = ps.seniorityIndex === ps.currentProposerIndex
        return (
            <div className={`mb-4 text-center p-2 rounded-lg border ${isCaptain && ps.phase === 'PROPOSAL' ? 'bg-yellow-900/20 border-yellow-500/50' : 'bg-blue-900/10 border-blue-500/20'}`}>
                <div className="font-mono font-bold tracking-wider text-sm">
                    {isCaptain ? '👑 YOU ARE THE CAPTAIN' : `🏴‍☠️ PIRATE #${ps.seniorityIndex}`}
                </div>
                {isCaptain && ps.phase === 'PROPOSAL' && <div className="text-[10px] text-yellow-300 mt-1 animate-pulse">It's your turn to distribute the booty!</div>}
            </div>
        )
    }
    return <div className="mb-4 text-center"><span className="text-xs font-bold text-gray-600 uppercase tracking-widest">Spectator Mode</span></div>
  }

  const renderPhaseAction = () => {
    // --- 1. REGISTRAZIONE ---
    if (ps.phase === 'REGISTRATION' || ps.phase === 'WAITING') {
        if (ps.hasRegistered) return <div className="text-center text-gray-500 italic text-xs">Waiting for crew...</div>
        return (
            <button className="btn btn-primary w-full font-black tracking-widest shadow-[0_0_15px_rgba(64,224,208,0.3)]"
                onClick={(e) => { e.stopPropagation(); onJoin(ps.id, 0, ps.fee || 0) }} disabled={loading}>
                {loading ? <span className="loading loading-spinner"></span> : `🏴‍☠️ JOIN CREW (${ps.fee || 0} A)`}
            </button>
        )
    }

    // --- 2. PROPOSTA ---
    if (ps.phase === 'PROPOSAL') {
        if (ps.seniorityIndex === ps.currentProposerIndex) {
            return (
                <div className="space-y-3 p-4 bg-white/5 rounded-xl border border-white/10" onClick={e => e.stopPropagation()}>
                    <div className="text-[10px] font-bold text-gray-400 text-center uppercase">Distribute {ps.totalPot} ALGO</div>
                    <div className="grid grid-cols-2 gap-2">
                        {Array.from({ length: ps.totalPirates }).map((_, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <span className="text-[10px] w-12 text-gray-500 font-mono">Pirate #{i}</span>
                                <input type="number" step="0.1" className="input input-xs input-bordered w-full text-center font-mono bg-black focus:border-yellow-500"
                                       placeholder="0.0" value={shares[i]} onClick={e => e.stopPropagation()}
                                       onChange={e => { const n = [...shares]; n[i] = e.target.value; setShares(n) }} />
                            </div>
                        ))}
                    </div>
                    <button className="btn btn-warning btn-sm w-full font-black tracking-widest" onClick={handlePropose} disabled={loading}>SEND PROPOSAL</button>
                </div>
            )
        }
        return <div className="text-center text-gray-500 animate-pulse text-xs">Waiting for Captain #{ps.currentProposerIndex} to propose...</div>
    }

    // --- 3. COMMIT (VOTO) ---
    if (ps.phase === 'COMMIT') {
        const isMeCaptain = ps.seniorityIndex === ps.currentProposerIndex
        return (
            <div className="space-y-4" onClick={e => e.stopPropagation()}>
                {/* Visualizzazione Torta (Proposta) */}
                <div className="p-3 bg-black/40 rounded-lg border border-white/10">
                    <div className="text-[10px] text-gray-500 uppercase text-center mb-2">Captain's Proposal</div>
                    <div className="flex flex-wrap justify-center gap-2">
                        {ps.currentProposal.map((amount: number, i: number) => (
                            <div key={i} className={`flex flex-col items-center p-2 rounded border ${i === ps.seniorityIndex ? 'bg-yellow-900/20 border-yellow-500 text-yellow-400' : 'bg-white/5 border-white/5 text-gray-400'}`}>
                                <span className="text-[9px] uppercase">Pirate #{i}</span>
                                <span className="font-mono font-bold text-sm">{amount.toFixed(2)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* BANNER: VOTO EFFETTUATO (Restaurato!) */}
                {ps.hasVoted && (
                    <div className={`p-4 rounded-xl border text-center ${ps.myVote === 1 ? 'bg-green-900/20 border-green-500/30' : 'bg-red-900/20 border-red-500/30'}`}>
                        <div className="text-[10px] uppercase font-bold tracking-widest mb-1 text-gray-400">Your Vote</div>
                        <div className={`text-2xl font-black ${ps.myVote === 1 ? 'text-green-400' : 'text-red-400'}`}>
                            {ps.myVote === 1 ? 'AYE (YES)' : 'NAY (NO)'}
                        </div>
                        <div className="text-[9px] text-gray-500 mt-1 font-mono flex justify-center items-center gap-1">
                            <span>🔒 Salt secured in browser</span>
                        </div>
                    </div>
                )}

                {/* Bottoni Voto (Se non ho votato, sono vivo e non sono il capitano) */}
                {!isMeCaptain && !ps.hasVoted && ps.isAlive && (
                    <div className="flex gap-2">
                        <button className="btn btn-success flex-1 font-black" onClick={(e) => {e.stopPropagation(); commitVote && commitVote(ps.id, 1)}} disabled={loading}>AYE! (YES)</button>
                        <button className="btn btn-error flex-1 font-black" onClick={(e) => {e.stopPropagation(); commitVote && commitVote(ps.id, 0)}} disabled={loading}>NAY! (NO)</button>
                    </div>
                )}

                {isMeCaptain && <div className="text-center text-yellow-500 text-xs">Praying for mutiny to fail...</div>}
            </div>
        )
    }

    // --- 4. REVEAL ---
    if (ps.phase === 'REVEAL') {
        if (ps.hasRevealed) {
            if (ps.rounds.current > ps.rounds.endReveal) return <button className="btn btn-warning w-full font-black mt-4" onClick={(e) => {e.stopPropagation(); executeRound && executeRound(ps.id)}} disabled={loading}>⚡ RESOLVE ROUND</button>
            return <div className="text-center text-green-500 font-bold text-xs">✓ REVEALED</div>
        }
        if (ps.hasVoted) return <button className="btn btn-info w-full font-black mt-4" onClick={(e) => {e.stopPropagation(); onReveal(ps.id)}} disabled={loading}>🔓 REVEAL VOTE</button>
        return null;
    }

    return null
  }

  return (
    <GenericSessionItem
      session={displaySession}
      loading={loading}
      onReveal={() => onReveal(ps.id)}
      onClaim={() => onClaim(ps.id, ps.fee)}
      getMyValueLabel={(s: any) => !s.isAlive ? '💀' : (s.seniorityIndex !== null ? `#${s.seniorityIndex}` : 'WATCHING')}
      phaseTextOverride={ps.phase}
      renderGameStats={(s: any) => (
        <div onClick={e => e.stopPropagation()}>
            {renderPlayerStatus()}
            <div className="grid grid-cols-3 gap-2 p-3 bg-black/20 rounded-lg border border-white/5 text-center font-mono text-xs mb-4">
                <div><div className="text-gray-500 uppercase text-[9px] tracking-widest">Proposer</div><div className="text-primary font-bold">#{s.currentProposerIndex}</div></div>
                <div><div className="text-gray-500 uppercase text-[9px] tracking-widest">Alive</div><div className="text-white font-bold">{s.alivePirates}/{s.totalPirates}</div></div>
                <div><div className="text-gray-500 uppercase text-[9px] tracking-widest">Votes</div><div className="text-white font-bold"><span className="text-green-400">{s.votesFor}</span> / <span className="text-red-400">{s.votesAgainst}</span></div></div>
            </div>
            {renderPhaseAction()}
        </div>
      )}
      renderJoinControls={() => null}
    />
  )
}

export const PirateGameDashboard = () => {
  const hook = usePirateGame()

  // FIX FLICKERING: Memoizzazione Context
  const actions = useMemo(() => ({
      proposeDistribution: hook.proposeDistribution,
      commitVote: hook.commitVote,
      executeRound: hook.executeRound
  }), [hook.proposeDistribution, hook.commitVote, hook.executeRound])

  return (
    <PirateActionsContext.Provider value={actions}>
        {/* Scroll Container */}
        <div className="h-[calc(100vh-200px)] overflow-y-auto pr-2 pb-20 custom-scrollbar">
            <GenericGameDashboard
              useGameHook={usePirateGame as any}
              SessionItemComponent={PirateSessionItem}
              defaultConfig={{ fee: 1, start: 50, commit: 50, reveal: 50 }}
              emptyStateConfig={{ icon: '🏴‍☠️', message: 'No pirate ships on the horizon.' }}
            />
        </div>
    </PirateActionsContext.Provider>
  )
}
