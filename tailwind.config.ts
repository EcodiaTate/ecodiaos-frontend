import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Pure black base — JARVIS-grade ambient OS surface.
        // surface = backgrounds (black family), on-surface = text (white family).
        surface: {
          DEFAULT: '#000000',
          dim: '#000000',
          'container-low': '#0a0a0a',
          container: '#111111',
          'container-high': '#181818',
          'container-lowest': '#000000',
        },
        'on-surface': {
          DEFAULT: '#e0e0e0',
          variant: '#b0b0b0',
          muted: '#666666',
        },
        primary: {
          DEFAULT: '#1B7A3D',
          container: '#2ECC71',
          light: '#5FE89D',
          dim: '#126B30',
        },
        secondary: {
          DEFAULT: '#10B981',
          container: '#6EE7B7',
          light: '#A7F3D0',
        },
        tertiary: {
          DEFAULT: '#D97706',
          container: '#FBBF24',
          light: '#FDE68A',
        },
        error: {
          DEFAULT: '#DC2626',
          container: '#FCA5A5',
        },
        outline: {
          variant: '#B0B5A8',
        },
        gold: {
          DEFAULT: '#D97706',
          bright: '#F59E0B',
          muted: '#B45309',
          glow: '#FBBF24',
          ember: '#EA580C',
        },
        // Accent for data viz contrast — always secondary to green+gold
        emerald: {
          DEFAULT: '#059669',
          light: '#34D399',
          glow: '#6EE7B7',
        },
      },
      fontFamily: {
        display: ['Space Grotesk', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        'display-lg': ['3.5rem', { lineHeight: '1.1', letterSpacing: '0.02em' }],
        'display-md': ['2.5rem', { lineHeight: '1.15', letterSpacing: '0.02em' }],
        'headline-md': ['1.75rem', { lineHeight: '1.3' }],
        'label-md': ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.05em' }],
        'label-sm': ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.05em' }],
      },
      borderRadius: {
        '2xl': '1.5rem',
        '3xl': '1.75rem',
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
        '26': '6.5rem',
        '28': '7rem',
      },
      boxShadow: {
        glass: '0 20px 50px -12px rgba(27, 122, 61, 0.05), 0 8px 20px -8px rgba(217, 119, 6, 0.02)',
        'glass-elevated': '0 32px 64px -16px rgba(27, 122, 61, 0.07), 0 12px 28px -8px rgba(217, 119, 6, 0.03)',
        'glass-hover': '0 28px 60px -14px rgba(27, 122, 61, 0.09), 0 10px 24px -8px rgba(251, 191, 36, 0.04)',
        'glass-floating': '0 40px 80px -20px rgba(27, 122, 61, 0.10), 0 16px 36px -10px rgba(217, 119, 6, 0.04)',
        'glow-primary': '0 0 24px rgba(46, 204, 113, 0.20), 0 0 48px rgba(46, 204, 113, 0.06)',
        'glow-active': '0 0 30px rgba(46, 204, 113, 0.28), 0 0 60px rgba(251, 191, 36, 0.08)',
        'glow-gold': '0 0 24px rgba(217, 119, 6, 0.20), 0 0 48px rgba(251, 191, 36, 0.08)',
        'glow-gold-active': '0 0 30px rgba(245, 158, 11, 0.28), 0 0 60px rgba(251, 191, 36, 0.12)',
        'glow-emerald': '0 0 24px rgba(5, 150, 105, 0.18), 0 0 48px rgba(52, 211, 153, 0.06)',
      },
      /* backdropBlur removed — no blur effects in the app */
      keyframes: {
        'aurora-breathe': {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
          '50%': { opacity: '0.7', transform: 'scale(1.06)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.5', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.15)' },
        },
        'float-drift': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'nav-breathe': {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.5' },
          '50%': { transform: 'scale(1.2)', opacity: '1' },
        },
      },
      animation: {
        'aurora-breathe': 'aurora-breathe 8s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 3s ease-in-out infinite',
        'float-drift': 'float-drift 7s ease-in-out infinite',
        'nav-breathe': 'nav-breathe 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
