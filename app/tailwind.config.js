/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        parchment: '#f4efe2',
        ink: '#3e2723',
        'ink-light': '#795548',
        'wood-dark': '#5d4037',
        'wood-mid': '#8b7355',
        'wood-light': '#c4b5a0',
        gold: '#c4a44a',
        qi: {
          full: '#4CAF50',
          warn: '#FFC107',
          danger: '#FF9800',
          critical: '#E53935',
        },
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', 'Georgia', 'serif'],
        sans: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
      maxWidth: {
        phone: '428px',
      },
    },
  },
  plugins: [],
};
