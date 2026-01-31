import React, { useState } from 'react'
import { PirateInfo } from '../../../hooks/Pirate/types'

interface MakeProposalFormProps {
  pirates: PirateInfo[]
  totalPot: number
  onSubmit: (distribution: number[]) => void
  loading: boolean
}

export const MakeProposalForm: React.FC<MakeProposalFormProps> = ({ pirates, totalPot, onSubmit, loading }) => {
  const [amounts, setAmounts] = useState<number[]>(new Array(pirates.length).fill(0))
  const [error, setError] = useState<string | null>(null)

  const currentSum = amounts.reduce((a, b) => a + b, 0)
  const remaining = totalPot - currentSum
  const isValid = Math.abs(remaining) < 0.0001

  const handleInputChange = (index: number, val: string) => {
    const newAmounts = [...amounts]
    newAmounts[index] = parseFloat(val) || 0
    setAmounts(newAmounts)
    setError(null)
  }

  const handleTakeRemainder = (index: number) => {
    const currentOthers = currentSum - amounts[index]
    const remainder = totalPot - currentOthers
    if (remainder >= 0) {
      const newAmounts = [...amounts]
      newAmounts[index] = parseFloat(remainder.toFixed(6))
      setAmounts(newAmounts)
    }
  }

  const handleSubmit = () => {
    if (!isValid) {
      setError(`Sum must match exactly ${totalPot}. Remaining: ${remaining.toFixed(4)}`)
      return
    }
    onSubmit(amounts)
  }

  return (
    <div className="bg-black/40 p-4 rounded-xl border border-purple-500/30 shadow-[0_0_15px_rgba(147,51,234,0.1)]">
      <div className="flex justify-between items-center mb-4">
        <h4 className="text-purple-400 font-bold uppercase tracking-widest text-xs">
          Distribute Booty
        </h4>
        <span className={`text-xs font-mono font-bold ${isValid ? 'text-green-400' : 'text-red-400'}`}>
          Remaining: {remaining.toFixed(2)} A
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto custom-scrollbar mb-4 pr-1">
        {pirates.map((p, idx) => (
          p.alive ? (
            <div key={idx} className="form-control">
              <label className="input-group input-group-xs">
                <span className="bg-white/5 text-[10px] w-8 justify-center font-mono text-gray-500">#{p.seniorityIndex}</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className={`input input-xs input-bordered w-full bg-transparent font-mono ${p.isCurrentProposer ? 'text-purple-400' : 'text-white'}`}
                  value={amounts[idx] || ''}
                  onChange={(e) => handleInputChange(idx, e.target.value)}
                  placeholder="0"
                />
                <button 
                  onClick={() => handleTakeRemainder(idx)}
                  className="btn btn-xs btn-ghost px-1 text-[8px]"
                  title="Take Max"
                >
                  MAX
                </button>
              </label>
            </div>
          ) : null
        ))}
      </div>

      {error && (
        <div className="text-red-400 text-xs font-bold text-center mb-3 animate-pulse bg-red-900/10 p-1 rounded">
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!isValid || loading}
        className="btn btn-sm btn-secondary w-full font-black tracking-widest shadow-[0_0_20px_#9333ea]"
      >
        {loading ? <span className="loading loading-spinner loading-xs"></span> : '📜 PUBLISH PROPOSAL'}
      </button>
    </div>
  )
}