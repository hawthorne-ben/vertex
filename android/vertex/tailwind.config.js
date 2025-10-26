/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(0, 0%, 100%)',
        foreground: 'hsl(0, 0%, 3.9%)',
        card: {
          DEFAULT: 'hsl(0, 0%, 100%)',
          foreground: 'hsl(0, 0%, 3.9%)',
        },
        primary: {
          DEFAULT: 'hsl(0, 0%, 9%)',
          foreground: 'hsl(0, 0%, 98%)',
        },
        secondary: {
          DEFAULT: 'hsl(0, 0%, 96.1%)',
          foreground: 'hsl(0, 0%, 9%)',
        },
        muted: {
          DEFAULT: 'hsl(0, 0%, 96.1%)',
          foreground: 'hsl(0, 0%, 45.1%)',
        },
        border: 'hsl(0, 0%, 89.8%)',
        input: 'hsl(0, 0%, 89.8%)',
        ring: 'hsl(0, 0%, 3.9%)',
        success: {
          DEFAULT: 'hsl(142, 76%, 36%)',
          background: 'hsl(142, 76%, 95%)',
        },
        error: {
          DEFAULT: 'hsl(0, 84%, 60%)',
          background: 'hsl(0, 84%, 95%)',
        },
      },
    },
  },
  plugins: [],
}
