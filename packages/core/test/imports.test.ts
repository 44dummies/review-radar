import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { extractSpecifiers } from '../src/imports/parser';
import { resolveSpecifier } from '../src/imports/resolve';
import { buildImportGraph } from '../src/imports/graph';
import { makeRepo } from './helpers/repo';

describe('extractSpecifiers', () => {
  it('finds TS imports, re-exports and require()', async () => {
    const src = `import a from './a';\nimport type { T } from "../t";\nexport * from './b';\nconst c = require('./c');\nfoo('./not-an-import');\n`;
    expect(await extractSpecifiers('ts', src)).toEqual(['./a', '../t', './b', './c']);
  });
  it('parses TSX', async () => {
    expect(await extractSpecifiers('tsx', `import X from './X';\nexport const Y = () => <X />;\n`)).toEqual(['./X']);
  });
  it('finds Python absolute, aliased and relative imports', async () => {
    const src = `import os\nimport pkg.mod as m\nfrom .sib import x\nfrom ..up.deep import y\nfrom . import z\nfrom pkg.other import w\n`;
    expect(await extractSpecifiers('py', src)).toEqual(['os', 'pkg.mod', '.sib', '..up.deep', '.', 'pkg.other']);
  });
  it('returns [] for unparseable garbage instead of throwing', async () => {
    expect(await extractSpecifiers('ts', '}{ ))) import')).toEqual([]);
  });
});

describe('resolveSpecifier', () => {
  const files = new Set(['src/a.ts', 'src/b/index.tsx', 'src/c.js', 'pkg/__init__.py', 'pkg/mod.py', 'pkg/sub/deep.py', 'src/util.ts']);
  const exists = (p: string) => files.has(p);
  it.each([
    ['src/x.ts', './a', 'ts', 'src/a.ts'],
    ['src/x.ts', './b', 'ts', 'src/b/index.tsx'],
    ['src/x.ts', './util.js', 'ts', 'src/util.ts'],
    ['src/x.ts', './c', 'ts', 'src/c.js'],
    ['src/x.ts', 'react', 'ts', undefined],
    ['pkg/sub/deep.py', '..mod', 'py', 'pkg/mod.py'],
    ['pkg/sub/x.py', '.deep', 'py', 'pkg/sub/deep.py'],
    ['app.py', 'pkg.mod', 'py', 'pkg/mod.py'],
    ['app.py', 'pkg', 'py', 'pkg/__init__.py'],
    ['app.py', 'os', 'py', undefined],
  ] as const)('%s imports %s', (from, spec, lang, want) => {
    expect(resolveSpecifier(from, spec, lang, exists)).toBe(want);
  });
});

describe('buildImportGraph', () => {
  it('builds reverse edges across TS and Python and caches by sha', async () => {
    const r = makeRepo();
    r.write({
      'src/core.ts': 'export const x = 1;\n',
      'src/a.ts': "import { x } from './core';\n",
      'src/b.tsx': "import { x } from './core';\n",
      'src/core.test.ts': "import { x } from './core';\n",
      'py/lib.py': 'X = 1\n',
      'py/use.py': 'from .lib import X\n',
      'py/__init__.py': '',
    });
    const head = r.commit('init');
    const g = await buildImportGraph(r.root, head);
    expect(g.importedBy('src/core.ts').sort()).toEqual(['src/a.ts', 'src/b.tsx', 'src/core.test.ts']);
    expect(g.importsOf('src/a.ts')).toEqual(['src/core.ts']);
    expect(g.importedBy('py/lib.py')).toEqual(['py/use.py']);
    expect(existsSync(join(r.root, '.reviewradar-cache'))).toBe(false);
    const gp = r.git('rev-parse', '--git-path', 'review-radar');
    const dir = isAbsolute(gp) ? gp : join(r.root, gp);
    expect(existsSync(join(dir, `graph-${head}.json`))).toBe(true);
    const cached = await buildImportGraph(r.root, head);
    expect(cached.importedBy('src/core.ts').sort()).toEqual(g.importedBy('src/core.ts').sort());
  });
});
