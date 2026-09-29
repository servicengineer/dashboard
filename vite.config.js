
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages ke liye: base me apne repo ka naam likhein, e.g. '/dashboard/'
export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
})