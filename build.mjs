import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const fontDir = join(root, 'node_modules/@fontsource-variable/onest/files');
const cyr = readFileSync(join(fontDir, 'onest-cyrillic-wght-normal.woff2')).toString('base64');
const lat = readFileSync(join(fontDir, 'onest-latin-wght-normal.woff2')).toString('base64');
let css = readFileSync(join(root, 'styles.css'), 'utf8')
  .replace('__FONT_CYRILLIC__', cyr)
  .replace('__FONT_LATIN__', lat);
const js = readFileSync(join(root, 'app.js'), 'utf8');
const html = readFileSync(join(root, 'index.template.html'), 'utf8')
  .replace('<!-- STYLES -->', () => `<style>${css}</style>`)
  .replace('<!-- SCRIPT -->', () => `<script>${js}</script>`);
writeFileSync(join(root, 'index.html'), html);
console.log(`Built index.html (${(html.length / 1024).toFixed(1)} KB)`);
