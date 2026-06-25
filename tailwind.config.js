/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Override indigo entirely with Galaxy gold palette
        // so every existing `indigo-*` class in the codebase becomes gold
        indigo: {
          50:  '#fdf9ed',
          100: '#f7ecc4',
          200: '#efd98a',
          300: '#d4af37',
          400: '#C9A840',
          500: '#C9A840',
          600: '#A07820',
          700: '#7a5e18',
          800: '#4e3b0d',
          900: '#2b1f08',
          950: '#160f03',
        },
        gold: {
          50:  '#fdf9ed',
          100: '#f7ecc4',
          200: '#efd98a',
          300: '#e5c555',
          400: '#d4af37',
          500: '#C9A840',
          600: '#A07820',
          700: '#A8872E',
          800: '#7a5e18',
          900: '#4e3b0d',
          950: '#2b200a',
        },
        galaxy: {
          950: '#030712',
          900: '#0d1117',
          800: '#161c2d',
          700: '#1e2640',
          600: '#2a3350',
          500: '#374166',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
