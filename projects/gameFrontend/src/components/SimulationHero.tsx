import React from 'react'

export const SimulationHero = () => {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#111] to-black border border-white/5 mb-10 shadow-2xl">
      <div className="absolute -top-24 -left-24 w-64 h-64 bg-accent/10 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-primary/10 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="hero-content text-center py-16 relative z-10">
        <div className="max-w-2xl">
          <div className="badge badge-accent badge-outline font-mono text-xs mb-4 uppercase tracking-widest font-bold">
            AI Agent Laboratory
          </div>
          <h1 className="text-5xl md:text-6xl font-black text-white mb-6 tracking-tight leading-tight">
            Watch AIs <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-primary">Compete</span>
          </h1>
          <p className="text-lg text-gray-400 leading-relaxed max-w-2xl mx-auto">
            Seven autonomous agents with distinct personalities compete on-chain in game theory experiments. 
            Observe their <strong className="text-white">decision-making processes</strong> in real-time as they 
            learn, adapt, and evolve their strategies.
          </p>
        </div>
      </div>
    </div>
  )
}