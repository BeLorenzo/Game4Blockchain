import React, { useState } from 'react'
import { DigitalInput } from '../ui/DigitalInput'

interface CreateGameFormProps {
  onCreate: (fee: number, start: number, commit: number, reveal: number) => void
  loading: boolean
  mbrCost: number // Costo MBR per mostrare all'utente quanto pagherà
}

export const CreateGameForm: React.FC<CreateGameFormProps> = ({ onCreate, loading, mbrCost }) => {
  const [fee, setFee] = useState('10')
  const [startDelay, setStartDelay] = useState('10') // Blocchi di attesa
  const [commitDuration, setCommitDuration] = useState('100')
  const [revealDuration, setRevealDuration] = useState('100')

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-8">
      <h3 className="text-lg font-black text-white mb-6 tracking-widest flex items-center gap-2">
        <span className="w-2 h-2 bg-primary rounded-full"></span>
        CREATE NEW SESSION
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase mb-2 block">Entry Fee</label>
          <DigitalInput value={fee} onChange={setFee} suffix="ALGO" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase mb-2 block">Start Delay (Rounds)</label>
          <DigitalInput value={startDelay} onChange={setStartDelay} suffix="ROUNDS" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase mb-2 block">Commit Phase</label>
          <DigitalInput value={commitDuration} onChange={setCommitDuration} suffix="ROUNDS" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase mb-2 block">Reveal Phase</label>
          <DigitalInput value={revealDuration} onChange={setRevealDuration} suffix="ROUNDS" />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-white/5 pt-4">
        <div className="text-xs text-gray-500 font-mono">
          Required Deposit (MBR): <span className="text-primary">{mbrCost.toFixed(3)} ALGO</span>
        </div>
        <button
          disabled={loading || !fee}
          onClick={() => onCreate(Number(fee), Number(startDelay), Number(commitDuration), Number(revealDuration))}
          className="btn btn-primary px-8 font-black tracking-widest text-black"
        >
          {loading ? 'CREATING...' : 'INITIALIZE SESSION'}
        </button>
      </div>
    </div>
  )
}
