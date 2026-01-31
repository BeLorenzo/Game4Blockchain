import React from 'react'

interface DigitalInputProps {
  value: string | number
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean

  suffix?: string
  label?: string
  
  actionLabel?: string
  onAction?: () => void
  isLoading?: boolean
  min?: number
  max?: number
}

export const DigitalInput: React.FC<DigitalInputProps> = ({
  value,
  onChange,
  placeholder = '0',
  disabled,
  suffix,
  label,
  actionLabel,
  onAction,
  isLoading,
  min,
  max
}) => {

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let newValue = e.target.value

    if (newValue === '') {
      onChange('')
      return
    }

    const numValue = parseFloat(newValue)

    if (max !== undefined && numValue > max) {
      newValue = max.toString()
    }

    if (min !== undefined && min >= 0 && numValue < 0) {
       newValue = '0' 
    }

    onChange(newValue)
  }

  return (
    <div className={`relative flex items-center bg-black/40 border rounded-xl transition-all group ${
      disabled ? 'opacity-50 cursor-not-allowed border-white/5' : 'border-white/10 focus-within:border-primary/50 focus-within:shadow-[0_0_20px_rgba(64,224,208,0.1)]'
    }`}>

      {label && (
        <div className="pl-4 font-bold text-[10px] text-gray-500 tracking-wider uppercase select-none whitespace-nowrap">
          {label}
        </div>
      )}

      <input
        type="number"
        value={value}
        onChange={handleInputChange}
        placeholder={placeholder}
        disabled={disabled}
        min={min}
        max={max}
        className={`w-full bg-transparent p-4 text-xl font-mono text-white placeholder-gray-600 outline-none ${label ? 'pl-2' : ''}`}
      />

      {suffix && !actionLabel && (
        <div className="pr-4 pointer-events-none">
          <span className="text-[10px] font-bold text-gray-500 bg-white/5 px-2 py-1 rounded border border-white/5">
            {suffix}
          </span>
        </div>
      )}

      {actionLabel && onAction && (
        <div className="pr-2">
          <button
            onClick={onAction}
            disabled={disabled || isLoading}
            className="btn btn-sm btn-primary font-black text-black tracking-widest h-9 min-h-0 px-4"
          >
            {isLoading ? <span className="loading loading-dots loading-xs"></span> : actionLabel}
          </button>
        </div>
      )}
    </div>
  )
}
