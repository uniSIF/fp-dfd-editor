/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  // ビルド結果を 1 つの index.html にまとめ、file:// で直接開けるようにする（design.md 7 章の制約）
  plugins: [react(), viteSingleFile()],
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
