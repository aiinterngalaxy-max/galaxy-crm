/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Override gray with true neutral-black (zinc values) — Tailwind's default gray is blue-tinted
        gray: {
          50:  '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
          950: '#09090b',
        },
        // Override indigo + blue entirely with Galaxy gold palette
        // so every existing `indigo-*` and `blue-*` class becomes gold
        blue: {
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
