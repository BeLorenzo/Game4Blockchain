import React from 'react'

export type GamePhaseFilter = 'ALL' | 'WAITING' | 'COMMIT' | 'REVEAL' | 'ENDED'

interface GameFiltersProps {
  activeTab: 'active' | 'history' | 'mine'
  setActiveTab: (tab: 'active' | 'history' | 'mine') => void
  phaseFilter: GamePhaseFilter
  setPhaseFilter: (phase: GamePhaseFilter) => void
  showMine?: boolean
}

export const GameFilters: React.FC<GameFiltersProps> = ({ activeTab, setActiveTab, phaseFilter, setPhaseFilter, showMine = true }) => {
  const getTabClass = (isActive: boolean) =>
    `tab h-10 px-6 rounded-lg font-bold uppercase tracking-wider transition-all duration-200 ${
      isActive ? 'bg-primary text-black shadow-[0_0_15px_rgba(64,224,208,0.3)] scale-105' : 'text-gray-400 hover:text-white hover:bg-white/5'
    }`

  const getFilterClass = (filterName: string) =>
    `btn btn-sm border-0 font-bold ${
      phaseFilter === filterName ? 'bg-white text-black hover:bg-gray-200' : 'bg-base-300 text-gray-500 hover:bg-base-100 hover:text-white'
    }`

  const phases: GamePhaseFilter[] = ['ALL', 'WAITING', 'COMMIT', 'REVEAL', 'ENDED']

  return (
    <>
      <div role="tablist" className="tabs tabs-boxed bg-transparent p-0 gap-3">
        <a role="tab" className={getTabClass(activeTab === 'active')} onClick={() => setActiveTab('active')}>Active</a>
        <a role="tab" className={getTabClass(activeTab === 'history')} onClick={() => setActiveTab('history')}>History</a>
        {showMine && <a role="tab" className={getTabClass(activeTab === 'mine')} onClick={() => setActiveTab('mine')}>My Games</a>}
      </div>
      <div className="flex gap-2 flex-wrap justify-center">
        {phases.map((f) => (
          <button key={f} className={getFilterClass(f)} onClick={() => setPhaseFilter(f)}>
            {f}
          </button>
        ))}
      </div>
    </>
  )
}
