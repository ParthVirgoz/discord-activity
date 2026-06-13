import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const colyseusTarget = env.VITE_COLYSEUS_PROXY || 'http://localhost:2567';

  return {
    server: {
      host: true,
      allowedHosts: true,
      headers: {
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
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
    },
  };
});
