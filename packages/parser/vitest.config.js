import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['spec/**/*.spec.js'],
    setupFiles: ['spec/setup.js'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/spec/**']
    },
    silent: false,
    testTimeout: 10000
  }
});