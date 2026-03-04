import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const browserTarget = process.argv[2];

if (browserTarget !== 'firefox' && browserTarget !== 'chrome') {
  console.error('Target browser must be firefox or chrome.');
  process.exit(1);
}

const source = resolve(process.cwd(), `manifest.${browserTarget}.json`);
const destination = resolve(process.cwd(), 'dist', 'manifest.json');

await copyFile(source, destination);
console.log(`Copied ${source} -> ${destination}`);
