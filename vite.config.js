import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/login': 'http://localhost:5000',
      '/register': 'http://localhost:5000',
      '/lockers': 'http://localhost:5000',
      '/booking': 'http://localhost:5000',
      '/payment-sessions': 'http://localhost:5000',
      '/my-bookings': 'http://localhost:5000',
      '/bookings': 'http://localhost:5000',
      '/users': 'http://localhost:5000',
      '/logs': 'http://localhost:5000',
      '/reports': 'http://localhost:5000',
      '/dashboard': 'http://localhost:5000',
      '/verify-pin': 'http://localhost:5000',
    },
  },
})
