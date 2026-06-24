/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        galaxy: {
          950: '#030712',
          900: '#0d1117',
          800: '#161c2d',
          700: '#1e2640',
          600: '#2a3350',
          500: '#374166',
          accent: '#6366f1',
          'accent-hover': '#4f46e5',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
