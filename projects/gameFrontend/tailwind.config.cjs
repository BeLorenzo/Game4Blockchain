/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'sans-serif'], // Font Moderno
        mono: ['JetBrains Mono', 'monospace'], // Font Tecnico
      },
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        glow: 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px #40E0D0, 0 0 10px #40E0D0' },
          '100%': { boxShadow: '0 0 20px #40E0D0, 0 0 30px #40E0D0' },
        },
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      {
        algorand: {
          primary: '#40E0D0', // CIANO
          'primary-content': '#000000',
          secondary: '#FFFFFF',
          accent: '#00539C', // BLU ALGORAND
          neutral: '#374151',
          'base-100': '#0A0A0A', // NERO PROFONDO
          'base-200': '#111111', // CARD
          'base-300': '#1A1A1A', // BORDI/INPUT
          'base-content': '#FFFFFF',
          info: '#3ABFF8',
          success: '#22C55E', // VERDE ACCESO
          warning: '#EAB308',
          error: '#EF4444',
        },
      },
    ],
  },
}
