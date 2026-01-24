import React from 'react'

interface Config {
  fee: number
  start: number
  commit: number
  reveal: number
}

interface CreateSessionFormProps {
  config: Config
  setConfig: (cfg: Config) => void
  onCreate: () => void
  loading: boolean
  disabled: boolean
}

export const CreateSessionForm: React.FC<CreateSessionFormProps> = ({ config, setConfig, onCreate, loading, disabled }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-5 items-end">
      <label className="form-control w-full">
        <div className="label pt-0 pb-1"><span className="label-text text-[11px] uppercase font-bold text-gray-500 tracking-wider">Fee (Algo)</span></div>
        <input type="number" value={config.fee} onChange={(e) => setConfig({ ...config, fee: parseFloat(e.target.value) })} className="input input-md input-bordered w-full font-mono text-lg bg-black/40 focus:border-primary text-center transition-all" />
      </label>
      <label className="form-control w-full">
        <div className="label pt-0 pb-1"><span className="label-text text-[11px] uppercase font-bold text-gray-500 tracking-wider">Start Round</span></div>
        <input type="number" value={config.start} onChange={(e) => setConfig({ ...config, start: parseInt(e.target.value) })} className="input input-md input-bordered w-full font-mono text-lg bg-black/40 focus:border-primary text-center transition-all" />
      </label>
      <label className="form-control w-full">
        <div className="label pt-0 pb-1"><span className="label-text text-[11px] uppercase font-bold text-gray-500 tracking-wider">Commit</span></div>
        <input type="number" value={config.commit} onChange={(e) => setConfig({ ...config, commit: parseInt(e.target.value) })} className="input input-md input-bordered w-full font-mono text-lg bg-black/40 focus:border-primary text-center transition-all" />
      </label>
      <label className="form-control w-full">
        <div className="label pt-0 pb-1"><span className="label-text text-[11px] uppercase font-bold text-gray-500 tracking-wider">Reveal</span></div>
        <input type="number" value={config.reveal} onChange={(e) => setConfig({ ...config, reveal: parseInt(e.target.value) })} className="input input-md input-bordered w-full font-mono text-lg bg-black/40 focus:border-primary text-center transition-all" />
      </label>
      <button
        className="btn btn-md btn-primary w-full text-black font-black tracking-widest shadow-[0_0_20px_rgba(64,224,208,0.3)] hover:scale-[1.02] transition-all"
        disabled={disabled}
        onClick={onCreate}
      >
        {loading ? <span className="loading loading-dots loading-md"></span> : 'CREATE'}
      </button>
    </div>
  )
}
