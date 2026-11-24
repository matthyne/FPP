import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// WebFPP version: package.json "version" (bump it with every change to web/), plus the git
// commit the build came from, shown in the status bar and the cheat-sheet footer.
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
let commit = '';
try {
  commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  /* not a git checkout */
}

// Served from https://<user>.github.io/FPP/ by .github/workflows/pages.yml
export default defineConfig({
  base: process.env.FM900_BASE ?? '/FPP/',
  plugins: [preact()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit),
  },
});
