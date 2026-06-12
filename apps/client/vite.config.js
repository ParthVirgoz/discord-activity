import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const colyseusTarget = env.VITE_COLYSEUS_PROXY || 'http://localhost:2567';

  return {
    server: {
      proxy: {
        '/colyseus': {
          target: colyseusTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/colyseus/, ''),
        },
        // REST routes (search, discord_token) share the Colyseus server
        '/api': {
          target: colyseusTarget,
          changeOrigin: true,
        },
      },
      allowedHosts: [
        'localhost',
        '.trycloudflare.com',
        '.ngrok-free.app',
      ],
    },
  };
});
