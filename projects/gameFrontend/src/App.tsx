import { AlertProvider } from './context/AlertContext'
import { Home } from './Home'

function App() {
  return (
    <AlertProvider>
      <div className="min-h-screen bg-[#050505] font-sans text-white selection:bg-primary selection:text-black">
        <Home />
      </div>
    </AlertProvider>
  )
}

export default App
