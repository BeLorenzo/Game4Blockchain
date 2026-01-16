import React, { createContext, useContext, useState, ReactNode } from 'react'

type AlertType = 'success' | 'error' | 'info' | 'warning'

interface Alert {
  message: string
  type: AlertType
  id: number
}

interface AlertContextType {
  showAlert: (message: string, type: AlertType) => void
}

const AlertContext = createContext<AlertContextType | undefined>(undefined)

export const AlertProvider = ({ children }: { children: ReactNode }) => {
  const [alerts, setAlerts] = useState<Alert[]>([])

  const showAlert = (message: string, type: AlertType) => {
    const id = Date.now()
    setAlerts((prev) => [...prev, { message, type, id }])
    setTimeout(() => {
      setAlerts((prev) => prev.filter((alert) => alert.id !== id))
    }, 5000)
  }

  return (
    <AlertContext.Provider value={{ showAlert }}>
      {/* MODIFICA:
          - fixed: rimane bloccato sullo schermo anche se scrolli
          - top-5: un po' di margine dall'alto
          - left-1/2 -translate-x-1/2: centra orizzontalmente
          - z-[9999]: sopra ogni altra cosa (modal, navbar, ecc)
          - flex-col: impila gli alert se ce ne sono più di uno
      */}
      <div className="fixed top-5 left-1/2 transform -translate-x-1/2 z-[9999] w-full max-w-md flex flex-col gap-2 px-4 pointer-events-none">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`alert alert-${alert.type} shadow-lg border-2 border-base-content/10 animate-in slide-in-from-top-2 fade-in duration-300 pointer-events-auto`}
          >
            {alert.type === 'error' && <span className="text-xl">🚨</span>}
            {alert.type === 'success' && <span className="text-xl">✅</span>}
            <div className="flex flex-col">
              <span className="font-bold text-xs uppercase opacity-50">{alert.type}</span>
              <span className="font-bold text-sm">{alert.message}</span>
            </div>
          </div>
        ))}
      </div>
      {children}
    </AlertContext.Provider>
  )
}

export const useAlert = () => {
  const context = useContext(AlertContext)
  if (!context) throw new Error('useAlert must be used within AlertProvider')
  return context
}
