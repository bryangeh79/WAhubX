import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom', // localStorage / axios 需要 DOM 伪装
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
