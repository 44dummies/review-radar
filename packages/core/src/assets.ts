import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Finds a wasm asset in: $REVIEW_RADAR_ASSETS, <bundle>/grammars, packages/core/grammars, web-tree-sitter. */
export function resolveAsset(file: string): string {
  const candidates = [
    process.env.REVIEW_RADAR_ASSETS && join(process.env.REVIEW_RADAR_ASSETS, file),
    join(here, 'grammars', file),           // bundled: dist/grammars next to the .mjs
    join(here, '..', 'grammars', file),     // source: packages/core/grammars
  ].filter(Boolean) as string[];
  for (const c of candidates) if (existsSync(c)) return c;
  if (file === 'web-tree-sitter.wasm') return require.resolve('web-tree-sitter/web-tree-sitter.wasm');
  throw new Error(`review-radar: asset ${file} not found (looked in ${candidates.join(', ')})`);
}
