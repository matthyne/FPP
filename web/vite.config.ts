import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Served from https://<user>.github.io/FPP/ by .github/workflows/pages.yml
export default defineConfig({
  base: process.env.FM900_BASE ?? '/FPP/',
  plugins: [preact()],
});
