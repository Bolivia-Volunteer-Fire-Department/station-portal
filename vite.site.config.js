import { resolve } from 'node:path';
import { renameSync, existsSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const buildTime = Date.now();
const appVersion = '1.805';

/**
 * Serves `site.html` at `/` during `npm run dev:site` and renames `dist-site/site.html`
 * to `dist-site/index.html` after `npm run build:site` so Firebase Hosting serves it at root.
 */
function siteEntryPlugin() {
  return {
    name: 'stationsync-site-entry',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/' || req.url === '/index.html' || req.url?.startsWith('/?')) {
          req.url = req.url.replace(/^\/(index\.html)?/, '/site.html');
        }
        next();
      });
    },
    closeBundle() {
      const outDir = resolve(process.cwd(), 'dist-site');
      const from = resolve(outDir, 'site.html');
      const to = resolve(outDir, 'index.html');
      if (existsSync(from)) {
        renameSync(from, to);
      }
    },
  };
}

export default defineConfig({
  base: '/',
  define: {
    'import.meta.env.APP_BUILD_TIME': JSON.stringify(buildTime),
    'import.meta.env.APP_VERSION': JSON.stringify(appVersion),
  },
  server: {
    port: 5174,
  },
  build: {
    outDir: 'dist-site',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'site.html'),
    },
  },
  plugins: [
    react({ compiler: true }),
    tailwindcss(),
    siteEntryPlugin(),
  ],
});

