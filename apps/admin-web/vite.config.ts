import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': {
        target: process.env.WEB_API_PROXY_TARGET || 'http://127.0.0.1:3000',
        // Keep the browser Host: same-origin /api requests must retain their Origin/Host pair.
        // Rewriting Host to the API address makes 127.0.0.1 development requests look cross-origin.
        changeOrigin: false,
      },
    },
  },
});
