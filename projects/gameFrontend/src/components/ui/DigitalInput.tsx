import React from 'react'

interface DigitalInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  suffix?: string // <--- Aggiunto Suffix
}

export const DigitalInput: React.FC<DigitalInputProps> = ({
  value,
  onChange,
  placeholder = '0.0',
  disabled,
  suffix
}) => {
  return (
    <div className={`relative flex items-center bg-black/40 border rounded-xl transition-all ${disabled ? 'opacity-50 cursor-not-allowed border-white/5' : 'border-white/10 focus-within:border-primary/50 focus-within:shadow-[0_0_20px_rgba(64,224,208,0.1)]'}`}>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full bg-transparent p-4 text-xl font-mono text-white placeholder-gray-600 outline-none"
      />
      {/* Renderizza il suffisso solo se presente */}
      {suffix && (
        <div className="pr-4 pointer-events-none">
          <span className="text-xs font-bold text-gray-500 bg-white/5 px-2 py-1 rounded border border-white/5">
            {suffix}
          </span>
        </div>
      )}
    </div>
  )
}
