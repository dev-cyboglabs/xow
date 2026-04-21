/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/**/*.{js,jsx,ts,tsx,html}',
  ],
  theme: {
    extend: {
      colors: {
        'card-bg': '#1a1a1a',
        'card-border': '#333333',
        'play-btn': '#E54B2A',
        'info-btn': '#4A5568',
        'surface': '#111111',
        'surface-2': '#1e1e1e',
        'surface-3': '#2a2a2a',
      },
    },
  },
  plugins: [],
};
