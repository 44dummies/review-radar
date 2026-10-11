// Bundles an entry into a single ESM file and copies the wasm assets next to it.
import { build } from 'esbuild';
import { chmodSync, cpSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, '..');
const targets = [
  { entry: 'packages/cli/src/cli.ts', outfile: 'packages/cli/dist/cli.mjs' },
  { entry: 'packages/action/src/main.ts', outfile: 'dist/index.mjs' },
];
const only = process.argv[2];

for (const t of targets) {
  if (only && !t.outfile.includes(only)) continue;
  await build({
    entryPoints: [join(root, t.entry)],
    outfile: join(root, t.outfile),
    bundle: true, platform: 'node', target: 'node20', format: 'esm', minify: false, sourcemap: false,
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: 'info',
  });
  const grammars = join(root, dirname(t.outfile), 'grammars');
  mkdirSync(grammars, { recursive: true });
  for (const f of readdirSync(join(root, 'packages/core/grammars'))) {
    if (f.endsWith('.wasm')) cpSync(join(root, 'packages/core/grammars', f), join(grammars, f));
  }
  cpSync(require.resolve('web-tree-sitter/web-tree-sitter.wasm'), join(grammars, 'web-tree-sitter.wasm'));
  // npm ships some wasm as 0755; normalise so dist/ is identical on every OS
  for (const f of readdirSync(grammars)) chmodSync(join(grammars, f), 0o644);
}
