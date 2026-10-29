import { defineConfig } from 'vite';
import { renameSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { viteSingleFile } from 'vite-plugin-singlefile';

const OUTPUT_NAME = 'supplier-eib-builder.html';

// Locks the built page down so supplier data can never leave the browser:
// no network requests of any kind, only inline scripts, styles, and data: images.
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

function cspAndRename() {
  return {
    name: 'commit-csp-and-rename',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
    closeBundle() {
      const dist = new URL('./dist/', import.meta.url).pathname;
      if (existsSync(join(dist, 'index.html'))) renameSync(join(dist, 'index.html'), join(dist, OUTPUT_NAME));
      // Everything is inlined, so nothing else belongs in dist.
      for (const f of readdirSync(dist)) if (f !== OUTPUT_NAME) rmSync(join(dist, f), { recursive: true });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [viteSingleFile(), cspAndRename()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 100_000_000,
  },
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
