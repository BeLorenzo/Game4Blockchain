import React, { useState } from 'react'

interface PirateConfig {
  fee: number
  maxPirates: number
  regDuration: number
  commitDuration: number
  revealDuration: number
}

interface CreatePirateSessionFormProps {
  onCreate: (cfg: PirateConfig) => void
  loading: boolean
  disabled: boolean
}

export const CreatePirateSessionForm: React.FC<CreatePirateSessionFormProps> = ({ onCreate, loading, disabled }) => {
  const [config, setConfig] = useState<PirateConfig>({
    fee: 10,
    maxPirates: 5,
    regDuration: 5,
    commitDuration: 5,
    revealDuration: 5
  })

  const handleChange = (key: keyof PirateConfig, val: string) => {
    setConfig(prev => ({ ...prev, [key]: parseFloat(val) || 0 }))
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-4 items-end">
      <label className="form-control w-full">
        <div className="label pt-0 pb-1"><span className="label-text text-[10px] uppercase font-bold text-gray-500">Fee (Algo)</span></div>
        <input type="number" value={config.fee} onChange={e => handleChange('fee', e.target.value)} className="input input-sm input-bordered w-full bg-black/40 font-mono text-center" />
      </label>
      
      <label className="form-control w-full">
        <div className="label pt-0 pb-1"><span className="label-text text-[10px] uppercase font-bold text-gray-500">Max Pirates</span></div>
        <input type="number" value={config.maxPirates} onChange={e => handleChange('maxPirates', e.target.value)} className="input input-sm input-bordered w-full bg-black/40 font-mono text-center" />
      </label>

      {/* Durations */}
      <label className="form-control w-full">
        <div className="label pt-0 pb-1"><span className="label-text text-[10px] uppercase font-bold text-gray-500">Reg (Rnds)</span></div>
        <input type="number" value={config.regDuration} onChange={e => handleChange('regDuration', e.target.value)} className="input input-sm input-bordered w-full bg-black/40 font-mono text-center" />
      </label>
      <label className="form-control w-full">
        <div className="label pt-0 pb-1"><span className="label-text text-[10px] uppercase font-bold text-gray-500">Commit (Rnds)</span></div>
        <input type="number" value={config.commitDuration} onChange={e => handleChange('commitDuration', e.target.value)} className="input input-sm input-bordered w-full bg-black/40 font-mono text-center" />
      </label>
      <label className="form-control w-full">
        <div className="label pt-0 pb-1"><span className="label-text text-[10px] uppercase font-bold text-gray-500">Reveal (Rnds)</span></div>
        <input type="number" value={config.revealDuration} onChange={e => handleChange('revealDuration', e.target.value)} className="input input-sm input-bordered w-full bg-black/40 font-mono text-center" />
      </label>

      <button
        className="btn btn-sm btn-primary h-10 w-full font-black tracking-widest shadow-[0_0_15px_rgba(64,224,208,0.3)]"
        disabled={disabled}
        onClick={() => onCreate(config)}
      >
        {loading ? <span className="loading loading-dots loading-xs"></span> : 'ARRR!'}
      </button>
    </div>
  )
}