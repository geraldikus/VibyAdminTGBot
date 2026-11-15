// Compiles the server to plain JS at build time, so production runs `node` directly
// (no tsx/esbuild processes at runtime). Dependencies stay external (node_modules);
// only our own code and @school/shared (published as .ts) are bundled.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => name !== '@school/shared');

await build({
  entryPoints: ['index', 'migrate-from-sheets', 'backup-cli', 'mirror-cli'].map((n) => path.join(here, 'src', `${n}.ts`)),
  outdir: path.join(here, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  alias: { '@school/shared': path.join(here, '../shared/src/index.ts') },
  logLevel: 'info',
});
