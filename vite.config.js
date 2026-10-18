import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const buildTime = Date.now();
const appVersion = '1.745';

function versionStampPlugin() {
  return {
    name: 'version-stamp-plugin',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({
          version: appVersion,
          buildTime,
        }, null, 2),
      });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/version.json') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ version: appVersion, buildTime }, null, 2));
          return;
        }
        next();
      });
    },
  };
}

// GitHub Pages serves project sites from https://<user>.github.io/<repo-name>/,
// while local dev/preview runs at the root. BASE_PATH is set by the CI workflow
// (e.g. /station-portal/) so asset URLs resolve correctly once deployed.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  define: {
    'import.meta.env.APP_BUILD_TIME': JSON.stringify(buildTime),
    'import.meta.env.APP_VERSION': JSON.stringify(appVersion),
  },
  plugins: [
    // The React Compiler runs as part of the build. It memoizes what each component computes, so a re-render does
    // the work that actually changed instead of all of it - and the repository has been written against its lint
    // rules for a while: oxlint's "React Compiler could not prove..." hints ARE those rules, reporting where a
    // component would be skipped. Enabling the compiler is the step those rules were waiting for.
    //
    // It fails SOFT by design: a component it cannot prove safe is left exactly as it was rather than breaking the
    // build, which is why scripts/verify-app-shell.mjs checks a build for evidence that the compiler ran at all -
    // a config that silently stopped being applied would otherwise look like a slightly faster build.
    react({ compiler: true }),
    tailwindcss(),
    versionStampPlugin(),
  ],
})