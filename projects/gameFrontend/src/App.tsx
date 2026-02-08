import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { AlertProvider } from './context/AlertContext'
import { Home } from './Home'
import { Navbar } from './components/Navbar'
import SimulationRunner from './pages/SimulationRunner'
import SimulationHome from './pages/SimulationHome'

function App() {
  return (
    <AlertProvider>
      <Router>
        <div className="min-h-screen bg-base-200 text-base-content font-sans selection:bg-primary selection:text-primary-content">
          <Navbar />
          
          <Routes>
            {/* Zona Interattiva (Umani) */}
            <Route path="/" element={<Home />} />
            
            {/* Zona Simulazione (AI Landing Page) */}
            <Route path="/simulation" element={<SimulationHome />} />
            
            {/* Zona Simulazione (Dashboard Esecuzione) */}
            <Route path="/simulation/run/:gameId" element={<SimulationRunner />} />
          </Routes>
          
        </div>
      </Router>
    </AlertProvider>
  )
}

export default App