import React, { createContext, useContext, useState, useCallback } from 'react'

interface AlertContextType {
  showAlert: (message: string, type: 'success' | 'error' | 'info') => void
}

const AlertContext = createContext<AlertContextType | undefined>(undefined)

export const AlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [alert, setAlert] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

  const showAlert = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    setAlert({ message, type })
    // Durata aumentata a 5 secondi per dare tempo di leggere
    setTimeout(() => setAlert(null), 5000)
  }, [])

  return (
    <AlertContext.Provider value={{ showAlert }}>
      {children}
      {alert && (
        <div className="toast toast-top toast-center z-[9999] w-full max-w-md mt-4 px-4">
          <div
            className={`alert shadow-2xl border-2 transform transition-all duration-300 scale-100 animate-bounce-in ${
              alert.type === 'error'
                ? 'alert-error border-red-900 bg-red-950 text-white'
                : alert.type === 'success'
                  ? 'alert-success border-green-800 bg-green-950 text-white'
                  : 'alert-info border-blue-900 bg-blue-950 text-white'
            }`}
          >
            {/* Icone grandi */}
            {alert.type === 'error' && (
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-8 w-8" fill="none" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            )}
            {alert.type === 'success' && (
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-8 w-8" fill="none" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            {alert.type === 'info' && (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 h-8 w-8">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                ></path>
              </svg>
            )}

            <div className="flex flex-col">
              <span className="font-bold text-lg uppercase tracking-wider">{alert.type}</span>
              <span className="text-sm font-medium">{alert.message}</span>
            </div>
          </div>
        </div>
      )}
    </AlertContext.Provider>
  )
}

export const useAlert = () => {
  const context = useContext(AlertContext)
  if (!context) throw new Error('useAlert must be used within AlertProvider')
  return context
}
