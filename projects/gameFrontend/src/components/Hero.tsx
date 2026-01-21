import React from 'react'

export const Hero = () => {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#111] to-black border border-white/5 mb-10 shadow-2xl">
      {/* Decorative Glow */}
      <div className="absolute -top-24 -left-24 w-64 h-64 bg-primary/10 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-accent/10 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="hero-content text-center py-16 relative z-10">
        <div className="max-w-2xl">
          <div className="badge badge-primary badge-outline font-mono text-xs mb-4 uppercase tracking-widest font-bold">
            Decentralized Gaming Protocol
          </div>
          <h1 className="text-5xl md:text-6xl font-black text-white mb-6 tracking-tight leading-tight">
            Play <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">On-Chain</span>
          </h1>
          <p className="text-lg text-gray-400 leading-relaxed max-w-lg mx-auto">
            Welcome to the simulation dashboard. No centralized servers here. <br />
            <strong className="text-white">Code is Law.</strong> Connect your wallet and challenge the blockchain.
          </p>
        </div>
      </div>
    </div>
  )
}
