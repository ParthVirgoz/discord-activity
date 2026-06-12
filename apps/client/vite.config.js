import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      /**
       * For convenience, forward "/colyseus" requests to the local Colyseus server.
       */
      '/colyseus': {
        target: 'https://discord-activity.up.railway.app',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/colyseus/, ''),
      },
    },

    allowedHosts: [
      'localhost',
      '.trycloudflare.com',
      '.ngrok-free.app',
    ],
  },
})
