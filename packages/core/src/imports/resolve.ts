import { posix } from 'node:path';
import type { Lang } from '../types';

const JS_EXTS = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

export function resolveSpecifier(fromFile: string, spec: string, lang: Lang, exists: (p: string) => boolean): string | undefined {
  const dir = posix.dirname(fromFile);
  if (lang !== 'py') {
    if (!spec.startsWith('.')) return undefined; // bare package import
    const target = posix.normalize(posix.join(dir, spec));
    const stems = [target];
    const jsExt = /\.(m|c)?js$/.exec(target);
    if (jsExt) stems.push(target.slice(0, -jsExt[0].length)); // TS ESM: './x.js' -> x.ts
    for (const stem of stems) for (const ext of JS_EXTS) if (exists(stem + ext)) return stem + ext;
    return undefined;
  }
  // Python
  let baseDir: string;
  let rest: string;
  const rel = /^(\.+)(.*)$/.exec(spec);
  if (rel) {
    baseDir = dir;
    for (let i = 1; i < rel[1]!.length; i++) baseDir = posix.dirname(baseDir);
    rest = rel[2]!;
  } else {
    baseDir = '';
    rest = spec;
  }
  const modPath = rest ? rest.split('.').join('/') : '';
  const roots = rel ? [baseDir] : ['', 'src'];
  for (const root of roots) {
    const stem = posix.join(root || '.', modPath).replace(/^\.\//, '');
    for (const cand of [`${stem}.py`, `${stem}/__init__.py`]) {
      const c = cand.replace(/^\/+/, '');
      if (c !== '.py' && exists(c)) return c;
    }
  }
  return undefined;
}
