/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          red:      '#C0241A',
          'red-dark':  '#9B1A13',
          'red-mid':   '#E8352A',
          'red-light': '#FDECEA',
          navy:     '#2B2F7E',
          'navy-dark': '#1E2260',
          'navy-light': '#EAEBF8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'brand-red': '0 8px 24px rgba(192,36,26,0.28)',
        'brand-navy': '0 8px 24px rgba(43,47,126,0.20)',
      },
    },
  },
  plugins: [],
}
