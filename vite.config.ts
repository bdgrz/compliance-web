import { askr } from '@askrjs/vite';
import { defineConfig } from 'vite-plus';

const apiProxyTarget =
  process.env.COMPLIANCE_API_PROXY_TARGET ?? 'http://127.0.0.1:5080';

export default defineConfig({
  plugins: [askr()],
  resolve: { preserveSymlinks: true },
  lint: {
    ignorePatterns: ['dist/**', 'node_modules/**'],
  },
  fmt: {
    semi: true,
    singleQuote: true,
    trailingComma: 'es5',
    printWidth: 80,
    tabWidth: 2,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': apiProxyTarget,
      '/auth': apiProxyTarget,
      '/healthz': apiProxyTarget,
      '/openapi': apiProxyTarget,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
