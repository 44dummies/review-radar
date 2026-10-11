# Review Radar v1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `review-radar` v1.0: a deterministic CLI and GitHub Action that scores every hunk of a PR 0–100 (P0/P1/P2) and prints the evidence behind each score.

**Architecture:** An npm-workspace monorepo. `packages/core` holds the pipeline (diff parser → context builders → signals → scorer → reporters) and does no network I/O. `packages/cli` and `packages/action` are thin wrappers bundled with esbuild into single `.mjs` files with the tree-sitter grammars copied alongside. The Action is a composite action: a Node step produces the risk map, comment, summary, annotations and a SARIF file, then `github/codeql-action/upload-sarif@v4` uploads it.

**Tech Stack:** TypeScript 5.9 (strict, ESM, `moduleResolution: Bundler`), Node ≥ 20, Vitest 5, web-tree-sitter 0.27.1 + vendored official grammar wasm (tree-sitter-typescript 0.23.2, tree-sitter-javascript 0.25.0, tree-sitter-python 0.25.0), yaml 2, picomatch 4, picocolors 1, ajv 8 (tests only), @actions/core 3, @actions/github 9, esbuild 0.28.

**Spec:** `docs/superpowers/specs/2026-10-11-review-radar-design.md`

## Global Constraints

- Node ≥ 20; `"type": "module"` everywhere; TypeScript `strict: true`.
- `packages/core` makes **no network calls**. Only `git` subprocesses and filesystem reads.
- Tiers: **P0 ≥ 70, P1 ≥ 40, P2 < 40**; `score = min(100, Σ weights)`.
- SARIF output is **2.1.0**; only P0 (`error`) and P1 (`warning`) hunks are emitted.
- Action: **one** PR comment, located by the marker `<!-- review-radar -->`, edited on every push and never re-posted; **≤ 10** `::error` annotations.
- CLI exit codes: `0` OK, `1` findings at or above `--fail-on`, `2` error.
- All internal paths are repo-relative POSIX (`/`); convert at the filesystem boundary only.
- Every Evidence carries a human sentence in `message`. No signal may emit a score without one.
- Commits: conventional messages, **no `Co-Authored-By` trailer and no "Generated with Claude Code" line** (user rule).
- npm package name: `review-radar` (verified free on 2026-10-11). GitHub repo: `44dummies/review-radar` (public).

## Review Focus

1. **Empty diff** (`base == head` or only ignored files): expect a clean "No reviewable changes" result and exit 0, not a crash. Test: Task 10.
2. **CRLF line endings** in diffs (Windows checkouts): expect identical hunks and ranges to LF. Test: Task 2.
3. **Binary, renamed and deleted files**: expect binary files to be listed as skipped, a rename to keep the new path with `oldPath`, and a deletion to produce a hunk at line 0 that the Action/SARIF clamp to line 1. Tests: Tasks 2 and 11.
4. **Shallow clone / missing base commit** (the default `actions/checkout` depth of 1): expect a clear error naming `fetch-depth: 0` (exit 2) when the base is missing, and a `churn` degradation warning when history is shallow. Tests: Tasks 2 and 4.
5. **SARIF location forms** from real tools: `file:///abs/path`, `uriBaseId: SRCROOT`, `./src/x.ts`, Windows `C:\…` and percent-encoded names. All must map to the same repo-relative path. Test: Task 9.

---

## File Structure

```
review-radar/
  package.json                     # workspaces, scripts, devDeps
  tsconfig.json                    # base strict config
  vitest.config.ts
  .gitignore
  action.yml                       # composite action (Task 13)
  scripts/
    fetch-grammars.mjs             # downloads official grammar wasm into packages/core/grammars (Task 5)
    bundle.mjs                     # esbuild bundle + copy grammars (Task 12)
  packages/core/
    package.json                   # name @review-radar/core, exports ./src/index.ts
    grammars/                      # vendored *.wasm + LICENSES.md (Task 5)
    src/
      index.ts                     # public API re-exports
      types.ts                     # all shared types (Task 1)
      errors.ts                    # RadarError (Task 1)
      git.ts                       # git() runner (Task 2)
      diff.ts                      # parseUnifiedDiff, getChangeSet (Task 2)
      lang.ts                      # languageOf, isTestFile (Task 2)
      config.ts                    # defaults + loadConfig (Task 3)
      history.ts                   # buildGitHistory, detectAiAuthorship (Task 4)
      assets.ts                    # resolveAsset for wasm (Task 5)
      imports/
        parser.ts                  # tree-sitter init + extractSpecifiers (Task 5)
        resolve.ts                 # resolveSpecifier (Task 5)
        graph.ts                   # buildImportGraph + cache (Task 5)
      symbols.ts                   # declaredSymbols (Task 8)
      lcov.ts                      # parseLcov (Task 8)
      sarif-input.ts               # parseSarif, normalizeUri (Task 9)
      signals/
        index.ts                   # defaultSignals registry
        size.ts diffusion.ts dependency-change.ts sensitive-path.ts   (Task 6)
        test-gaming.ts                                              (Task 7)
        blast-radius.ts untested-change.ts churn.ts                 (Task 8)
        external-sarif.ts                                           (Task 9)
      scorer.ts                    # scoreHunks, summarize (Task 10)
      analyze.ts                   # analyze() orchestrator (Task 10)
      reporters/
        terminal.ts markdown.ts json.ts sarif.ts index.ts           (Task 11)
    test/
      helpers/repo.ts              # makeRepo() temp git repo helper (Task 2)
      fixtures/sarif-schema-2.1.0.json (Task 11)
      *.test.ts
  packages/cli/
    package.json                   # name review-radar, bin
    src/cli.ts                     # (Task 12)
    test/cli.test.ts
  packages/action/
    package.json
    src/main.ts src/comment.ts     # (Task 13)
    test/comment.test.ts
  dist/                            # action bundle, committed for the Action (Task 13)
  .github/workflows/ci.yml         # tests + dogfood (Task 14)
  README.md LICENSE                # (Task 14)
```

---

### Task 1: Monorepo scaffold and core types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `packages/core/package.json`, `packages/core/src/types.ts`, `packages/core/src/errors.ts`, `packages/core/src/index.ts`
- Modify: `.gitignore`
- Test: `packages/core/test/types.test.ts`

**Interfaces:**
- Produces: every type in `types.ts` below, and `RadarError(code, message)` with `code: 'BASE_NOT_FOUND' | 'NOT_A_REPO' | 'BAD_INPUT' | 'GIT_FAILED'`.

- [ ] **Step 1: Root config files**

`package.json`:
```json
{
  "name": "review-radar-monorepo",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p .",
    "grammars": "node scripts/fetch-grammars.mjs",
    "build": "node scripts/bundle.mjs"
  },
  "devDependencies": {
    "@types/node": "^20.19.0",
    "@types/picomatch": "^4.0.0",
    "@vitest/coverage-v8": "^5.0.3",
    "ajv": "^8.20.0",
    "esbuild": "^0.28.2",
    "typescript": "^5.9.0",
    "vitest": "^5.0.3"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["packages/*/src", "packages/*/test", "vitest.config.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 20000,
    coverage: { include: ['packages/core/src/**'], thresholds: { lines: 80 } },
  },
});
```

`.gitignore` gets these lines added (keep the existing ones): `.reviewradar-cache/`, `packages/*/dist/`. The root `dist/` stays **tracked**, because the Action runs from it. Remove the `dist/` line from `.gitignore` and add `packages/*/dist/` instead.

`packages/core/package.json`:
```json
{
  "name": "@review-radar/core",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "picomatch": "^4.0.7",
    "web-tree-sitter": "0.27.1",
    "yaml": "^2.9.1"
  }
}
```

Run: `npm install`
TypeScript is pinned to 5.9 on purpose: 7.x is the Go-based compiler, and its `tsc` behaviour hasn't been checked for this setup.

- [ ] **Step 2: Write the failing test**

`packages/core/test/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { RadarError, tierFor } from '../src/index';

describe('core basics', () => {
  it('RadarError carries a code', () => {
    const e = new RadarError('BASE_NOT_FOUND', 'missing');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('BASE_NOT_FOUND');
    expect(e.message).toBe('missing');
  });
  it('tierFor maps score to tier at the spec thresholds', () => {
    expect(tierFor(70)).toBe('P0');
    expect(tierFor(69)).toBe('P1');
    expect(tierFor(40)).toBe('P1');
    expect(tierFor(39)).toBe('P2');
    expect(tierFor(0)).toBe('P2');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run packages/core/test/types.test.ts`
Expected: FAIL, `Cannot find module '../src/index'`.

- [ ] **Step 4: Implement**

`packages/core/src/types.ts`:
```ts
export type Lang = 'ts' | 'tsx' | 'js' | 'py';
export type Tier = 'P0' | 'P1' | 'P2';

/** 1-based inclusive line range. start = 0 means "no lines on this side" (pure add/delete). */
export interface Range { start: number; end: number }

export interface Hunk {
  id: string;            // `${file}:${newRange.start}-${newRange.end}`
  file: string;          // repo-relative POSIX path (new path)
  oldRange: Range;
  newRange: Range;
  added: string[];       // added line texts, no leading '+'
  removed: string[];     // removed line texts, no leading '-'
  addedLines: number[];  // new-file line numbers of each added line
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  language?: Lang;
  isTest: boolean;
  hunks: Hunk[];
}

export interface ChangeSet { base: string; head: string; files: ChangedFile[] }

/** hunkId '*' means "applies to every hunk" (PR-level evidence). */
export interface Evidence {
  signal: string;
  hunkId: string;
  weight: number;
  message: string;
  lines?: Range;
  ruleId?: string;
}

export interface HunkRisk { hunk: Hunk; score: number; tier: Tier; evidence: Evidence[] }

export interface Summary {
  hunks: number;
  p0: number;
  p1: number;
  p2: number;
  estMinutes: number;
  skippedFiles: string[];
}

export interface AiAuthorship { likely: boolean; reasons: string[] }

export interface RiskMap {
  changeSet: ChangeSet;
  hunks: HunkRisk[];
  summary: Summary;
  meta: { version: string; warnings: string[]; aiAuthored: AiAuthorship };
}

export interface ImportGraph {
  importedBy(path: string): string[];
  importsOf(path: string): string[];
}

export interface GitHistory {
  churn(path: string): number;
  shallow: boolean;
}

export interface SarifResult {
  tool: string;
  ruleId: string;
  level: 'error' | 'warning' | 'note' | 'none';
  message: string;
  file: string;          // repo-relative POSIX
  startLine: number;
  endLine: number;
}

export interface LcovData { lines(path: string): Map<number, number> | undefined }

export interface Weights {
  sensitivePath: number;
  sensitiveCode: number;
  blastRadiusPerImporter: number;
  blastRadiusMax: number;
  untestedChange: number;
  testGaming: number;
  dependencyManifest: number;
  dependencyMajor: number;
  dependencyLockfile: number;
  churnPerChange: number;
  churnMax: number;
  churnMin: number;
  sizePer10Lines: number;
  sizeMax: number;
  sizeMin: number;
  diffusion: number;
  sarifError: number;
  sarifWarning: number;
  sarifNote: number;
}

export interface Config {
  weights: Weights;
  tiers: { p0: number; p1: number };
  sensitivePaths: string[];   // regex sources, case-insensitive
  sensitiveCode: string[];    // regex sources, case-insensitive
  ignore: string[];           // picomatch globs
  churnDays: number;
  diffusion: { files: number; dirs: number };
}

export interface Context {
  repoRoot: string;
  changeSet: ChangeSet;
  importGraph: ImportGraph;
  git: GitHistory;
  sarif: SarifResult[];
  lcov?: LcovData;
  config: Config;
  readFile(path: string): string | undefined; // repo-relative; undefined if missing
  testFiles: string[];                         // all tracked test files
}

export interface Signal {
  name: string;
  run(ctx: Context): Promise<Evidence[]> | Evidence[];
}

export function tierFor(score: number, tiers = { p0: 70, p1: 40 }): Tier {
  if (score >= tiers.p0) return 'P0';
  if (score >= tiers.p1) return 'P1';
  return 'P2';
}
```

Note: `Signal.run` takes only `ctx`, because `ctx.changeSet` carries the change set. This is the spec's `run(changeSet, ctx)` folded into one argument. Evidence gains `hunkId`, which the spec implies ("Evidence[] per hunk").

`packages/core/src/errors.ts`:
```ts
export type RadarErrorCode = 'BASE_NOT_FOUND' | 'NOT_A_REPO' | 'BAD_INPUT' | 'GIT_FAILED';
export class RadarError extends Error {
  constructor(public readonly code: RadarErrorCode, message: string) {
    super(message);
    this.name = 'RadarError';
  }
}
```

`packages/core/src/index.ts`:
```ts
export * from './types';
export * from './errors';
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run packages/core/test/types.test.ts && npm run typecheck`
Expected: 2 passed; tsc exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo with core types"
```

---

### Task 2: Git runner, language helpers, and diff parser

**Files:**
- Create: `packages/core/src/git.ts`, `packages/core/src/lang.ts`, `packages/core/src/diff.ts`, `packages/core/test/helpers/repo.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/diff.test.ts`, `packages/core/test/lang.test.ts`

**Interfaces:**
- Consumes: `ChangedFile`, `Hunk`, `ChangeSet`, `RadarError` (Task 1).
- Produces:
  - `git(repoRoot: string, args: string[]): string`. Throws `RadarError('GIT_FAILED')`.
  - `languageOf(path: string): Lang | undefined`, `isTestFile(path: string): boolean`
  - `parseUnifiedDiff(text: string): ChangedFile[]`
  - `getChangeSet(repoRoot: string, range?: string): ChangeSet`
  - Test helper `makeRepo(): Repo` with `{ root, write(files: Record<string,string>), rm(path), commit(msg, opts?: {author?: string; email?: string}): string, git(...args): string }`

- [ ] **Step 1: Test helper**

`packages/core/test/helpers/repo.ts`:
```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface Repo {
  root: string;
  git(...args: string[]): string;
  write(files: Record<string, string>): void;
  rm(path: string): void;
  commit(msg: string, opts?: { author?: string; email?: string }): string;
}

export function makeRepo(): Repo {
  const root = mkdtempSync(join(tmpdir(), 'rr-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'core.autocrlf', 'false');
  git('config', 'commit.gpgsign', 'false');
  return {
    root,
    git,
    write(files) {
      for (const [p, content] of Object.entries(files)) {
        const abs = join(root, p);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
      }
    },
    rm(p) { rmSync(join(root, p)); },
    commit(msg, opts = {}) {
      git('add', '-A');
      const author = `${opts.author ?? 'Test'} <${opts.email ?? 'test@example.com'}>`;
      git('commit', '-q', '--allow-empty', '-m', msg, `--author=${author}`);
      return git('rev-parse', 'HEAD');
    },
  };
}
```

- [ ] **Step 2: Write failing tests**

`packages/core/test/lang.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { languageOf, isTestFile } from '../src/lang';

describe('languageOf', () => {
  it.each([
    ['a.ts', 'ts'], ['a.mts', 'ts'], ['a.cts', 'ts'], ['a.tsx', 'tsx'],
    ['a.js', 'js'], ['a.jsx', 'js'], ['a.mjs', 'js'], ['a.cjs', 'js'],
    ['a.py', 'py'], ['a.go', undefined], ['Makefile', undefined],
  ])('%s -> %s', (p, lang) => expect(languageOf(p)).toBe(lang));
});

describe('isTestFile', () => {
  it.each([
    ['src/a.test.ts', true], ['src/a.spec.jsx', true], ['__tests__/a.js', true],
    ['tests/test_api.py', true], ['pkg/api_test.py', true], ['test/helpers/x.ts', true],
    ['src/testing.ts', false], ['src/contest.py', false], ['src/a.ts', false],
  ])('%s -> %s', (p, v) => expect(isTestFile(p)).toBe(v));
});
```

`packages/core/test/diff.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff, getChangeSet } from '../src/diff';
import { RadarError } from '../src/errors';
import { makeRepo } from './helpers/repo';

const MODIFY = [
  'diff --git a/src/auth.ts b/src/auth.ts',
  'index 111..222 100644',
  '--- a/src/auth.ts',
  '+++ b/src/auth.ts',
  '@@ -3,2 +3,3 @@ export function login() {',
  '-  return check(a);',
  '-  // old',
  '+  if (!a) throw new Error();',
  '+  return check(a, b);',
  '+  // new',
  '@@ -20 +21,0 @@',
  '-const unused = 1;',
  '',
].join('\n');

describe('parseUnifiedDiff', () => {
  it('parses hunks, ranges, added/removed lines and added line numbers', () => {
    const [f] = parseUnifiedDiff(MODIFY);
    expect(f!.path).toBe('src/auth.ts');
    expect(f!.status).toBe('modified');
    expect(f!.language).toBe('ts');
    expect(f!.hunks).toHaveLength(2);
    const [h1, h2] = f!.hunks;
    expect(h1!.oldRange).toEqual({ start: 3, end: 4 });
    expect(h1!.newRange).toEqual({ start: 3, end: 5 });
    expect(h1!.added).toEqual(['  if (!a) throw new Error();', '  return check(a, b);', '  // new']);
    expect(h1!.removed).toHaveLength(2);
    expect(h1!.addedLines).toEqual([3, 4, 5]);
    expect(h1!.id).toBe('src/auth.ts:3-5');
    expect(h2!.oldRange).toEqual({ start: 20, end: 20 });
    expect(h2!.newRange).toEqual({ start: 21, end: 21 });
    expect(h2!.added).toEqual([]);
  });

  it('treats CRLF diffs identically to LF', () => {
    const crlf = parseUnifiedDiff(MODIFY.replace(/\n/g, '\r\n'));
    expect(crlf).toEqual(parseUnifiedDiff(MODIFY));
  });

  it('handles new, deleted, renamed and binary files', () => {
    const text = [
      'diff --git a/n.py b/n.py', 'new file mode 100644', '--- /dev/null', '+++ b/n.py',
      '@@ -0,0 +1,2 @@', '+import os', '+print(1)',
      'diff --git a/tests/old.test.ts b/tests/old.test.ts', 'deleted file mode 100644',
      '--- a/tests/old.test.ts', '+++ /dev/null', '@@ -1,2 +0,0 @@', "-it('x', () => {});", '-',
      'diff --git a/a/x.ts b/b/y.ts', 'similarity index 90%', 'rename from a/x.ts', 'rename to b/y.ts',
      'diff --git a/logo.png b/logo.png', 'Binary files a/logo.png and b/logo.png differ',
      'diff --git a/z.ts b/z.ts', '--- a/z.ts', '+++ b/z.ts', '@@ -1 +1 @@', '-a', '+b',
      '\\ No newline at end of file', '',
    ].join('\n');
    const files = parseUnifiedDiff(text);
    expect(files.map((f) => [f.path, f.status, f.binary])).toEqual([
      ['n.py', 'added', false],
      ['tests/old.test.ts', 'deleted', false],
      ['b/y.ts', 'renamed', false],
      ['logo.png', 'modified', true],
      ['z.ts', 'modified', false],
    ]);
    expect(files[0]!.hunks[0]!.addedLines).toEqual([1, 2]);
    expect(files[1]!.isTest).toBe(true);
    expect(files[1]!.hunks[0]!.newRange).toEqual({ start: 0, end: 0 });
    expect(files[1]!.hunks[0]!.id).toBe('tests/old.test.ts:0-0');
    expect(files[2]!.oldPath).toBe('a/x.ts');
    expect(files[4]!.hunks[0]!.added).toEqual(['b']);
  });

  it('returns [] for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});

describe('getChangeSet', () => {
  it('diffs an explicit base..head range', () => {
    const r = makeRepo();
    r.write({ 'src/a.ts': 'export const a = 1;\n' });
    const base = r.commit('init');
    r.write({ 'src/a.ts': 'export const a = 2;\n' });
    const head = r.commit('change');
    const cs = getChangeSet(r.root, `${base}..${head}`);
    expect(cs.base).toBe(base);
    expect(cs.head).toBe(head);
    expect(cs.files.map((f) => f.path)).toEqual(['src/a.ts']);
  });

  it('defaults to merge-base with main', () => {
    const r = makeRepo();
    r.write({ 'a.ts': '1\n' });
    const base = r.commit('init');
    r.git('checkout', '-q', '-b', 'feature');
    r.write({ 'a.ts': '2\n' });
    r.commit('feat');
    const cs = getChangeSet(r.root);
    expect(cs.base).toBe(base);
    expect(cs.files).toHaveLength(1);
  });

  it('throws BASE_NOT_FOUND with a fetch-depth hint for an unknown base', () => {
    const r = makeRepo();
    r.write({ 'a.ts': '1\n' });
    r.commit('init');
    try {
      getChangeSet(r.root, 'deadbeef..HEAD');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RadarError);
      expect((e as RadarError).code).toBe('BASE_NOT_FOUND');
      expect((e as RadarError).message).toContain('fetch-depth: 0');
    }
  });

  it('throws NOT_A_REPO outside git', () => {
    expect(() => getChangeSet(process.platform === 'win32' ? 'C:\\' : '/')).toThrow(RadarError);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run packages/core/test/diff.test.ts packages/core/test/lang.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`packages/core/src/git.ts`:
```ts
import { execFileSync } from 'node:child_process';
import { RadarError } from './errors';

export function git(repoRoot: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr ?? String(e);
    throw new RadarError('GIT_FAILED', `git ${args.join(' ')} failed: ${stderr.trim()}`);
  }
}

export function tryGit(repoRoot: string, args: string[]): string | undefined {
  try { return git(repoRoot, args); } catch { return undefined; }
}
```

`packages/core/src/lang.ts`:
```ts
import type { Lang } from './types';

const EXT: Record<string, Lang> = {
  ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', py: 'py',
};

export function languageOf(path: string): Lang | undefined {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? EXT[m[1]!.toLowerCase()] : undefined;
}

const TEST_PATTERNS = [
  /(^|\/)(__tests__|tests?)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.py$/,
];

export function isTestFile(path: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(path));
}
```

`packages/core/src/diff.ts`:
```ts
import type { ChangedFile, ChangeSet, Hunk, Range } from './types';
import { languageOf, isTestFile } from './lang';
import { git, tryGit } from './git';
import { RadarError } from './errors';

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function range(start: number, count: number): Range {
  if (count === 0) return { start, end: start };
  return { start, end: start + count - 1 };
}

function stripPrefix(p: string): string {
  return p.replace(/^[ab]\//, '');
}

export function parseUnifiedDiff(text: string): ChangedFile[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const files: ChangedFile[] = [];
  let file: ChangedFile | undefined;
  let hunk: Hunk | undefined;
  let newLine = 0;

  const finishFile = () => {
    if (file) {
      file.language = languageOf(file.path);
      file.isTest = isTestFile(file.path);
      files.push(file);
    }
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      finishFile();
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      file = { path: m ? m[2]! : '', status: 'modified', binary: false, isTest: false, hunks: [] };
      hunk = undefined;
      continue;
    }
    if (!file) continue;
    if (hunk === undefined) {
      if (line.startsWith('new file mode')) { file.status = 'added'; continue; }
      if (line.startsWith('deleted file mode')) { file.status = 'deleted'; continue; }
      if (line.startsWith('rename from ')) { file.status = 'renamed'; file.oldPath = line.slice(12); continue; }
      if (line.startsWith('rename to ')) { file.path = line.slice(10); continue; }
      if (line.startsWith('Binary files ')) { file.binary = true; continue; }
      if (line.startsWith('--- ')) {
        const p = line.slice(4);
        if (p !== '/dev/null' && file.status === 'deleted') file.path = stripPrefix(p);
        continue;
      }
      if (line.startsWith('+++ ')) {
        const p = line.slice(4);
        if (p !== '/dev/null') file.path = stripPrefix(p);
        continue;
      }
    }
    const hm = HUNK_RE.exec(line);
    if (hm) {
      const oldStart = Number(hm[1]);
      const oldCount = hm[2] === undefined ? 1 : Number(hm[2]);
      const newStart = Number(hm[3]);
      const newCount = hm[4] === undefined ? 1 : Number(hm[4]);
      const newRange = range(newStart, newCount);
      hunk = {
        id: `${file.path}:${newRange.start}-${newRange.end}`,
        file: file.path,
        oldRange: range(oldStart, oldCount),
        newRange,
        added: [],
        removed: [],
        addedLines: [],
      };
      file.hunks.push(hunk);
      newLine = newStart;
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('+')) {
      hunk.added.push(line.slice(1));
      hunk.addedLines.push(newLine++);
    } else if (line.startsWith('-')) {
      hunk.removed.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      newLine++;
    }
    // '\ No newline at end of file' and blank trailing lines are ignored
  }
  finishFile();
  return files;
}

function defaultBranch(repoRoot: string): string | undefined {
  const originHead = tryGit(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.trim();
  if (originHead) return originHead;
  for (const b of ['main', 'master', 'origin/main', 'origin/master']) {
    if (tryGit(repoRoot, ['rev-parse', '--verify', '--quiet', `${b}^{commit}`])) return b;
  }
  return undefined;
}

function resolveCommit(repoRoot: string, ref: string, role: 'base' | 'head'): string {
  const sha = tryGit(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])?.trim();
  if (!sha) {
    throw new RadarError(
      role === 'base' ? 'BASE_NOT_FOUND' : 'BAD_INPUT',
      `Cannot find ${role} commit "${ref}". In GitHub Actions use actions/checkout with fetch-depth: 0.`,
    );
  }
  return sha;
}

export function getChangeSet(repoRoot: string, rangeArg?: string): ChangeSet {
  if (!tryGit(repoRoot, ['rev-parse', '--is-inside-work-tree'])) {
    throw new RadarError('NOT_A_REPO', `${repoRoot} is not inside a git repository.`);
  }
  let base: string;
  let head: string;
  if (rangeArg) {
    const parts = rangeArg.split(/\.\.\.?/);
    if (parts.length !== 2 || !parts[0]) throw new RadarError('BAD_INPUT', `Range must look like base..head, got "${rangeArg}".`);
    base = resolveCommit(repoRoot, parts[0], 'base');
    head = resolveCommit(repoRoot, parts[1] || 'HEAD', 'head');
  } else {
    head = resolveCommit(repoRoot, 'HEAD', 'head');
    const branch = defaultBranch(repoRoot);
    if (!branch) throw new RadarError('BASE_NOT_FOUND', 'No default branch found. Pass an explicit range like main..HEAD. In GitHub Actions use fetch-depth: 0.');
    const mb = tryGit(repoRoot, ['merge-base', branch, head])?.trim();
    if (!mb) throw new RadarError('BASE_NOT_FOUND', `No merge-base between ${branch} and HEAD. In GitHub Actions use actions/checkout with fetch-depth: 0.`);
    base = mb;
  }
  const text = git(repoRoot, ['diff', '--no-color', '--no-ext-diff', '-U0', '-M', base, head]);
  return { base, head, files: parseUnifiedDiff(text) };
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './git';
export * from './lang';
export * from './diff';
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run packages/core/test/diff.test.ts packages/core/test/lang.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): unified diff parser and change set resolution"
```

---

### Task 3: Config defaults and loader

**Files:**
- Create: `packages/core/src/config.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/config.test.ts`

**Interfaces:**
- Consumes: `Config`, `Weights` (Task 1), `RadarError`.
- Produces: `DEFAULT_CONFIG: Config`, `loadConfig(repoRoot: string, configPath?: string): Config` (reads `.reviewradar.yml` when present and deep-merges it over the defaults), `isIgnored(path: string, cfg: Config): boolean`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, isIgnored } from '../src/config';
import { RadarError } from '../src/errors';
import { makeRepo } from './helpers/repo';

describe('config', () => {
  it('returns defaults when no file exists', () => {
    const r = makeRepo();
    expect(loadConfig(r.root)).toEqual(DEFAULT_CONFIG);
  });

  it('merges partial weights, tiers and appends extra sensitive paths', () => {
    const r = makeRepo();
    r.write({ '.reviewradar.yml': 'weights:\n  testGaming: 90\ntiers:\n  p0: 80\nsensitivePaths:\n  - "ledger"\n' });
    const cfg = loadConfig(r.root);
    expect(cfg.weights.testGaming).toBe(90);
    expect(cfg.weights.sensitivePath).toBe(DEFAULT_CONFIG.weights.sensitivePath);
    expect(cfg.tiers).toEqual({ p0: 80, p1: 40 });
    expect(cfg.sensitivePaths).toContain('ledger');
    expect(cfg.sensitivePaths).toContain('auth');
  });

  it('rejects invalid YAML with BAD_INPUT', () => {
    const r = makeRepo();
    r.write({ '.reviewradar.yml': 'weights: [unclosed' });
    expect(() => loadConfig(r.root)).toThrow(RadarError);
  });

  it('throws BAD_INPUT when an explicit config path is missing', () => {
    const r = makeRepo();
    expect(() => loadConfig(r.root, 'nope.yml')).toThrow(/nope\.yml/);
  });

  it('ignores dist, build, vendor and minified files by default', () => {
    expect(isIgnored('dist/index.js', DEFAULT_CONFIG)).toBe(true);
    expect(isIgnored('packages/x/build/a.js', DEFAULT_CONFIG)).toBe(true);
    expect(isIgnored('static/app.min.js', DEFAULT_CONFIG)).toBe(true);
    expect(isIgnored('src/a.ts', DEFAULT_CONFIG)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/core/test/config.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/core/src/config.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { parse } from 'yaml';
import picomatch from 'picomatch';
import type { Config } from './types';
import { RadarError } from './errors';

export const DEFAULT_CONFIG: Config = {
  weights: {
    sensitivePath: 45,
    sensitiveCode: 35,
    blastRadiusPerImporter: 3,
    blastRadiusMax: 30,
    untestedChange: 25,
    testGaming: 70,
    dependencyManifest: 30,
    dependencyMajor: 20,
    dependencyLockfile: 10,
    churnPerChange: 2,
    churnMax: 20,
    churnMin: 3,
    sizePer10Lines: 2,
    sizeMax: 20,
    sizeMin: 20,
    diffusion: 10,
    sarifError: 40,
    sarifWarning: 20,
    sarifNote: 5,
  },
  tiers: { p0: 70, p1: 40 },
  sensitivePaths: [
    'auth', 'login', 'session', 'token', 'jwt', 'oauth', 'passw', 'secret', 'credential',
    'crypto', 'encrypt', 'permission', 'rbac', 'acl', 'payment', 'billing', 'checkout',
    'stripe', 'mpesa', 'invoice', 'migrations?/', '(^|/)\\.env', '(^|/)Dockerfile$',
    '^\\.github/workflows/',
  ],
  sensitiveCode: [
    'child_process', '\\bexec(Sync)?\\(', '\\beval\\(', 'new Function\\(', 'dangerouslySetInnerHTML',
    '\\bsubprocess\\.', 'os\\.system\\(', 'pickle\\.loads', 'yaml\\.load\\(', 'bcrypt', 'jwt\\.(sign|verify|decode)',
    'createHash\\(|createCipher', 'innerHTML\\s*=', 'verify\\s*=\\s*False', 'rejectUnauthorized:\\s*false',
  ],
  ignore: ['**/dist/**', '**/build/**', '**/vendor/**', '**/*.min.js', 'dist/**', 'build/**', 'vendor/**'],
  churnDays: 90,
  diffusion: { files: 10, dirs: 5 },
};

type Partial2<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : Partial<T[K]>) : T[K] };

export function loadConfig(repoRoot: string, configPath?: string): Config {
  const p = configPath ? (isAbsolute(configPath) ? configPath : join(repoRoot, configPath)) : join(repoRoot, '.reviewradar.yml');
  if (!existsSync(p)) {
    if (configPath) throw new RadarError('BAD_INPUT', `Config file not found: ${configPath}`);
    return structuredClone(DEFAULT_CONFIG);
  }
  let raw: Partial2<Config>;
  try {
    raw = (parse(readFileSync(p, 'utf8')) ?? {}) as Partial2<Config>;
  } catch (e) {
    throw new RadarError('BAD_INPUT', `Invalid YAML in ${p}: ${(e as Error).message}`);
  }
  const d = structuredClone(DEFAULT_CONFIG);
  return {
    weights: { ...d.weights, ...(raw.weights ?? {}) },
    tiers: { ...d.tiers, ...(raw.tiers ?? {}) },
    sensitivePaths: [...d.sensitivePaths, ...(raw.sensitivePaths ?? [])],
    sensitiveCode: [...d.sensitiveCode, ...(raw.sensitiveCode ?? [])],
    ignore: [...d.ignore, ...(raw.ignore ?? [])],
    churnDays: raw.churnDays ?? d.churnDays,
    diffusion: { ...d.diffusion, ...(raw.diffusion ?? {}) },
  };
}

const matcherCache = new WeakMap<Config, (p: string) => boolean>();
export function isIgnored(path: string, cfg: Config): boolean {
  let m = matcherCache.get(cfg);
  if (!m) {
    m = picomatch(cfg.ignore, { dot: true });
    matcherCache.set(cfg, m);
  }
  return m(path);
}
```

Append to `index.ts`: `export * from './config';`

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/core/test/config.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): config defaults and .reviewradar.yml loader"
```

---

### Task 4: Git history (churn, shallow detection) and AI-authorship

**Files:**
- Create: `packages/core/src/history.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/history.test.ts`

**Interfaces:**
- Consumes: `git`, `tryGit` (Task 2), `GitHistory`, `AiAuthorship` (Task 1).
- Produces: `buildGitHistory(repoRoot: string, head: string, days: number): GitHistory`, `detectAiAuthorship(repoRoot: string, base: string, head: string): AiAuthorship`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/history.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildGitHistory, detectAiAuthorship } from '../src/history';
import { makeRepo } from './helpers/repo';

describe('buildGitHistory', () => {
  it('counts commits touching each path', () => {
    const r = makeRepo();
    for (let i = 0; i < 4; i++) { r.write({ 'hot.ts': `${i}\n` }); r.commit(`c${i}`); }
    r.write({ 'cold.ts': '1\n' });
    const head = r.commit('cold');
    const h = buildGitHistory(r.root, head, 90);
    expect(h.churn('hot.ts')).toBe(4);
    expect(h.churn('cold.ts')).toBe(1);
    expect(h.churn('missing.ts')).toBe(0);
    expect(h.shallow).toBe(false);
  });

  it('reports shallow clones', () => {
    const r = makeRepo();
    r.write({ 'a.ts': '1\n' }); r.commit('1');
    r.write({ 'a.ts': '2\n' }); r.commit('2');
    const dest = join(mkdtempSync(join(tmpdir(), 'rr-shallow-')), 'c');
    execFileSync('git', ['clone', '-q', '--depth', '1', pathToFileURL(r.root).href, dest]);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dest, encoding: 'utf8' }).trim();
    expect(buildGitHistory(dest, head, 90).shallow).toBe(true);
  });
});

describe('detectAiAuthorship', () => {
  it('flags Co-Authored-By agent trailers and bot authors', () => {
    const r = makeRepo();
    r.write({ 'a.ts': '1\n' });
    const base = r.commit('init');
    r.write({ 'a.ts': '2\n' });
    r.commit('feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>');
    r.write({ 'a.ts': '3\n' });
    const head = r.commit('fix', { author: 'copilot-swe-agent[bot]', email: 'bot@users.noreply.github.com' });
    const ai = detectAiAuthorship(r.root, base, head);
    expect(ai.likely).toBe(true);
    expect(ai.reasons.join(' ')).toMatch(/Claude/);
    expect(ai.reasons.join(' ')).toMatch(/copilot-swe-agent\[bot\]/);
  });

  it('is not likely for plain human commits', () => {
    const r = makeRepo();
    r.write({ 'a.ts': '1\n' });
    const base = r.commit('init');
    r.write({ 'a.ts': '2\n' });
    const head = r.commit('human change');
    expect(detectAiAuthorship(r.root, base, head)).toEqual({ likely: false, reasons: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/core/test/history.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/core/src/history.ts`:
```ts
import type { AiAuthorship, GitHistory } from './types';
import { tryGit } from './git';

export function buildGitHistory(repoRoot: string, head: string, days: number): GitHistory {
  const shallow = tryGit(repoRoot, ['rev-parse', '--is-shallow-repository'])?.trim() === 'true';
  const out = tryGit(repoRoot, ['log', `--since=${days}.days`, '--format=%x00', '--name-only', head]) ?? '';
  const counts = new Map<string, number>();
  for (const commit of out.split('\0')) {
    const paths = new Set(commit.split('\n').map((s) => s.trim()).filter(Boolean));
    for (const p of paths) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return { shallow, churn: (p) => counts.get(p) ?? 0 };
}

const AGENT_NAMES = 'Claude|Copilot|Cursor|Codex|Devin|Aider|Gemini|Jules|Windsurf|Cline|OpenHands|Sweep|Amp';
const TRAILER_RE = new RegExp(`^Co-Authored-By:\\s*(.*(?:${AGENT_NAMES}).*)$`, 'im');
const FOOTER_RE = /Generated with \[?(Claude Code|Cursor|Codex|Aider)/i;
const BOT_RE = new RegExp(`(\\[bot\\]|${AGENT_NAMES})`, 'i');

export function detectAiAuthorship(repoRoot: string, base: string, head: string): AiAuthorship {
  const out = tryGit(repoRoot, ['log', '--format=%an%x1f%ae%x1f%B%x1e', `${base}..${head}`]) ?? '';
  const reasons = new Set<string>();
  for (const rec of out.split('\x1e')) {
    const [name = '', , body = ''] = rec.trim().split('\x1f');
    if (!name) continue;
    if (BOT_RE.test(name)) reasons.add(`commit author ${name}`);
    const t = TRAILER_RE.exec(body);
    if (t) reasons.add(`Co-Authored-By: ${t[1]!.trim()}`);
    const f = FOOTER_RE.exec(body);
    if (f) reasons.add(`"Generated with ${f[1]}" footer`);
  }
  return { likely: reasons.size > 0, reasons: [...reasons] };
}
```

Append to `index.ts`: `export * from './history';`

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/core/test/history.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): git churn history and AI-authorship detection"
```

---

### Task 5: Vendored grammars and import graph

**Files:**
- Create: `scripts/fetch-grammars.mjs`, `packages/core/grammars/LICENSES.md`, `packages/core/src/assets.ts`, `packages/core/src/imports/parser.ts`, `packages/core/src/imports/resolve.ts`, `packages/core/src/imports/graph.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/imports.test.ts`

**Interfaces:**
- Consumes: `Lang`, `ImportGraph` (Task 1), `languageOf` (Task 2), `git` (Task 2).
- Produces:
  - `resolveAsset(file: string): string` (absolute path to a `.wasm` file)
  - `extractSpecifiers(lang: Lang, source: string): Promise<string[]>`
  - `resolveSpecifier(fromFile: string, spec: string, lang: Lang, exists: (p: string) => boolean): string | undefined`
  - `buildImportGraph(repoRoot: string, head: string, opts?: { useCache?: boolean; maxFiles?: number }): Promise<ImportGraph>`

**Background (verified 2026-10-11):** `tree-sitter-wasms@0.1.13` grammars **fail** to load in `web-tree-sitter@0.27.1` (`getDylinkMetadata` error). The official grammar npm packages ship compatible `.wasm` files: `tree-sitter-typescript@0.23.2` (`tree-sitter-typescript.wasm`, `tree-sitter-tsx.wasm`, ABI 14), `tree-sitter-javascript@0.25.0` and `tree-sitter-python@0.25.0` (ABI 15). We vendor those 4 files because installing the grammar packages directly would run native build scripts.

- [ ] **Step 1: Grammar fetch script and vendored files**

`scripts/fetch-grammars.mjs`:
```js
// Downloads official tree-sitter grammar wasm files into packages/core/grammars.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PKGS = {
  'tree-sitter-typescript@0.23.2': ['tree-sitter-typescript.wasm', 'tree-sitter-tsx.wasm'],
  'tree-sitter-javascript@0.25.0': ['tree-sitter-javascript.wasm'],
  'tree-sitter-python@0.25.0': ['tree-sitter-python.wasm'],
};
const out = join(import.meta.dirname, '..', 'packages', 'core', 'grammars');
mkdirSync(out, { recursive: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const [spec, files] of Object.entries(PKGS)) {
  const dir = mkdtempSync(join(tmpdir(), 'rr-g-'));
  execFileSync(npm, ['pack', spec, '--silent'], { cwd: dir, shell: process.platform === 'win32' });
  const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'));
  execFileSync('tar', ['xzf', tgz], { cwd: dir });
  for (const f of files) copyFileSync(join(dir, 'package', f), join(out, f));
  console.log(`vendored ${files.join(', ')} from ${spec}`);
}
```

Run: `npm run grammars`
Expected: 3 "vendored" lines; `packages/core/grammars/` contains 4 `.wasm` files.

`packages/core/grammars/LICENSES.md`:
```markdown
# Vendored grammars

| File | Source | License |
|---|---|---|
| tree-sitter-typescript.wasm, tree-sitter-tsx.wasm | npm tree-sitter-typescript@0.23.2 | MIT (c) Max Brunsfeld |
| tree-sitter-javascript.wasm | npm tree-sitter-javascript@0.25.0 | MIT (c) Max Brunsfeld |
| tree-sitter-python.wasm | npm tree-sitter-python@0.25.0 | MIT (c) Max Brunsfeld |

Regenerate with `npm run grammars`.
```

- [ ] **Step 2: Write the failing test**

`packages/core/test/imports.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
    expect(existsSync(join(r.root, '.reviewradar-cache', `graph-${head}.json`))).toBe(true);
    const cached = await buildImportGraph(r.root, head);
    expect(cached.importedBy('src/core.ts').sort()).toEqual(g.importedBy('src/core.ts').sort());
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run packages/core/test/imports.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement assets and parser**

`packages/core/src/assets.ts`:
```ts
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
```

`packages/core/src/imports/parser.ts`:
```ts
import { Parser, Language, Query } from 'web-tree-sitter';
import type { Lang } from '../types';
import { resolveAsset } from '../assets';

const GRAMMAR: Record<Lang, string> = {
  ts: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  js: 'tree-sitter-javascript.wasm',
  py: 'tree-sitter-python.wasm',
};

const JS_QUERY = `
(import_statement source: (string (string_fragment) @spec))
(export_statement source: (string (string_fragment) @spec))
(call_expression function: (identifier) @fn arguments: (arguments . (string (string_fragment) @spec)))
`;
const PY_QUERY = `
(import_statement name: (dotted_name) @spec)
(import_statement name: (aliased_import name: (dotted_name) @spec))
(import_from_statement module_name: (dotted_name) @spec)
(import_from_statement module_name: (relative_import) @spec)
`;

let init: Promise<void> | undefined;
const loaded = new Map<Lang, Promise<{ parser: Parser; query: Query }>>();

function load(lang: Lang) {
  let p = loaded.get(lang);
  if (!p) {
    p = (async () => {
      init ??= Parser.init({ locateFile: (f: string) => resolveAsset(f) });
      await init;
      const language = await Language.load(resolveAsset(GRAMMAR[lang]));
      const parser = new Parser();
      parser.setLanguage(language);
      return { parser, query: new Query(language, lang === 'py' ? PY_QUERY : JS_QUERY) };
    })();
    loaded.set(lang, p);
  }
  return p;
}

export async function extractSpecifiers(lang: Lang, source: string): Promise<string[]> {
  const { parser, query } = await load(lang);
  const tree = parser.parse(source);
  if (!tree) return [];
  try {
    const out: string[] = [];
    for (const m of query.matches(tree.rootNode)) {
      const fn = m.captures.find((c) => c.name === 'fn');
      if (fn && fn.node.text !== 'require') continue;
      const spec = m.captures.find((c) => c.name === 'spec');
      if (spec) out.push(spec.node.text);
    }
    return out;
  } finally {
    tree.delete();
  }
}
```

- [ ] **Step 5: Implement resolver and graph**

`packages/core/src/imports/resolve.ts`:
```ts
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
```

`packages/core/src/imports/graph.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImportGraph } from '../types';
import { git } from '../git';
import { languageOf } from '../lang';
import { extractSpecifiers } from './parser';
import { resolveSpecifier } from './resolve';

type Edges = Record<string, string[]>; // file -> files it imports

function fromEdges(edges: Edges): ImportGraph {
  const reverse = new Map<string, string[]>();
  for (const [from, tos] of Object.entries(edges)) {
    for (const to of tos) {
      const list = reverse.get(to) ?? [];
      list.push(from);
      reverse.set(to, list);
    }
  }
  return { importsOf: (p) => edges[p] ?? [], importedBy: (p) => reverse.get(p) ?? [] };
}

export async function buildImportGraph(
  repoRoot: string,
  head: string,
  opts: { useCache?: boolean; maxFiles?: number } = {},
): Promise<ImportGraph> {
  const useCache = opts.useCache ?? true;
  const cacheDir = join(repoRoot, '.reviewradar-cache');
  const cacheFile = join(cacheDir, `graph-${head}.json`);
  if (useCache && existsSync(cacheFile)) {
    return fromEdges(JSON.parse(readFileSync(cacheFile, 'utf8')) as Edges);
  }
  const tracked = git(repoRoot, ['ls-files', '-z']).split('\0').filter(Boolean);
  const all = new Set(tracked);
  const sources = tracked.filter((f) => languageOf(f)).slice(0, opts.maxFiles ?? 5000);
  const edges: Edges = {};
  for (const file of sources) {
    const lang = languageOf(file)!;
    let text: string;
    try { text = readFileSync(join(repoRoot, file), 'utf8'); } catch { continue; }
    if (text.length > 1_000_000) continue; // skip generated giants
    const specs = await extractSpecifiers(lang, text);
    const resolved = new Set<string>();
    for (const s of specs) {
      const r = resolveSpecifier(file, s, lang, (p) => all.has(p));
      if (r && r !== file) resolved.add(r);
    }
    if (resolved.size) edges[file] = [...resolved];
  }
  if (useCache) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(edges));
  }
  return fromEdges(edges);
}
```

Append to `index.ts`:
```ts
export * from './assets';
export * from './imports/parser';
export * from './imports/resolve';
export * from './imports/graph';
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run packages/core/test/imports.test.ts`
Expected: all pass. If the `fn` / `spec` capture order differs and `./not-an-import` shows up, check that the `fn` filter runs per match (`query.matches`, not `captures`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): tree-sitter import graph for TS/JS/Python with vendored grammars"
```

---

### Task 6: Diff-level signals (size, diffusion, dependency-change, sensitive-path)

**Files:**
- Create: `packages/core/src/signals/size.ts`, `packages/core/src/signals/diffusion.ts`, `packages/core/src/signals/dependency-change.ts`, `packages/core/src/signals/sensitive-path.ts`, `packages/core/test/helpers/ctx.ts`
- Test: `packages/core/test/signals-diff.test.ts`

**Interfaces:**
- Consumes: `Signal`, `Context`, `Evidence`, `ChangeSet` (Task 1), `parseUnifiedDiff` (Task 2), `DEFAULT_CONFIG` (Task 3).
- Produces: `sizeSignal`, `diffusionSignal`, `dependencyChangeSignal`, `sensitivePathSignal`, each a `Signal`. Test helper `fakeCtx(diff: string, over?: Partial<Context>): Context`.

- [ ] **Step 1: Context test helper**

`packages/core/test/helpers/ctx.ts`:
```ts
import type { Context } from '../../src/types';
import { parseUnifiedDiff } from '../../src/diff';
import { DEFAULT_CONFIG } from '../../src/config';

/** Build a diff string from {path: [removedLines, addedLines]} for compact tests. */
export function diffOf(files: Record<string, { add?: string[]; del?: string[]; start?: number; status?: 'added' | 'deleted' }>): string {
  const out: string[] = [];
  for (const [p, f] of Object.entries(files)) {
    const add = f.add ?? [], del = f.del ?? [], s = f.start ?? 1;
    out.push(`diff --git a/${p} b/${p}`);
    if (f.status === 'added') out.push('new file mode 100644');
    if (f.status === 'deleted') out.push('deleted file mode 100644');
    out.push(`--- ${f.status === 'added' ? '/dev/null' : `a/${p}`}`, `+++ ${f.status === 'deleted' ? '/dev/null' : `b/${p}`}`);
    out.push(`@@ -${s},${del.length} +${f.status === 'deleted' ? 0 : s},${add.length} @@`);
    out.push(...del.map((l) => `-${l}`), ...add.map((l) => `+${l}`));
  }
  return out.join('\n') + '\n';
}

export function fakeCtx(diff: string, over: Partial<Context> = {}): Context {
  return {
    repoRoot: '/repo',
    changeSet: { base: 'b', head: 'h', files: parseUnifiedDiff(diff) },
    importGraph: { importedBy: () => [], importsOf: () => [] },
    git: { churn: () => 0, shallow: false },
    sarif: [],
    config: structuredClone(DEFAULT_CONFIG),
    readFile: () => undefined,
    testFiles: [],
    ...over,
  };
}
```

- [ ] **Step 2: Write the failing test**

`packages/core/test/signals-diff.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { sizeSignal } from '../src/signals/size';
import { diffusionSignal } from '../src/signals/diffusion';
import { dependencyChangeSignal } from '../src/signals/dependency-change';
import { sensitivePathSignal } from '../src/signals/sensitive-path';
import { diffOf, fakeCtx } from './helpers/ctx';

const lines = (n: number) => Array.from({ length: n }, (_, i) => `x${i}`);

describe('size', () => {
  it('ignores small hunks and scales big ones up to the cap', () => {
    const ctx = fakeCtx(diffOf({ 'a.ts': { add: lines(10) }, 'b.ts': { add: lines(45) }, 'c.ts': { add: lines(500) } }));
    const ev = sizeSignal.run(ctx) as any[];
    expect(ev.map((e) => [e.hunkId.split(':')[0], e.weight])).toEqual([['b.ts', 8], ['c.ts', 20]]);
    expect(ev[0]!.message).toBe('hunk changes 45 lines');
  });
});

describe('diffusion', () => {
  it('emits one PR-level evidence when many files/dirs are touched', () => {
    const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`d${i % 6}/f${i}.ts`, { add: ['x'] }]));
    const ev = diffusionSignal.run(fakeCtx(diffOf(files))) as any[];
    expect(ev).toEqual([expect.objectContaining({ hunkId: '*', weight: 10, message: 'PR touches 12 files across 6 directories' })]);
  });
  it('is silent for small PRs', () => {
    expect(diffusionSignal.run(fakeCtx(diffOf({ 'a.ts': { add: ['x'] } })))).toEqual([]);
  });
});

describe('dependency-change', () => {
  it('flags new npm deps and major bumps in package.json', () => {
    const ctx = fakeCtx(diffOf({
      'package.json': { del: ['    "react": "^18.2.0",'], add: ['    "react": "^19.0.0",', '    "left-pad": "^1.3.0",'] },
    }));
    const msgs = (dependencyChangeSignal.run(ctx) as any[]).map((e) => [e.message, e.weight]);
    expect(msgs).toContainEqual(['adds dependency `left-pad@^1.3.0`', 30]);
    expect(msgs).toContainEqual(['bumps `react` 18 → 19 (major)', 50]);
  });
  it('flags requirements.txt additions and lockfile-only changes', () => {
    const ctx = fakeCtx(diffOf({ 'requirements.txt': { add: ['requests==2.32.0'] }, 'package-lock.json': { add: lines(30) } }));
    const msgs = (dependencyChangeSignal.run(ctx) as any[]).map((e) => [e.message, e.weight]);
    expect(msgs).toContainEqual(['adds dependency `requests==2.32.0`', 30]);
    expect(msgs).toContainEqual(['lockfile changed (30 lines)', 10]);
  });
  it('ignores non-dependency package.json fields', () => {
    const ctx = fakeCtx(diffOf({ 'package.json': { del: ['  "version": "1.0.0",'], add: ['  "version": "1.1.0",'] } }));
    expect(dependencyChangeSignal.run(ctx)).toEqual([]);
  });
});

describe('sensitive-path', () => {
  it('flags sensitive paths once per hunk', () => {
    const ctx = fakeCtx(diffOf({ 'src/auth/session.ts': { add: ['x'] }, 'src/ui/button.ts': { add: ['x'] } }));
    const ev = sensitivePathSignal.run(ctx) as any[];
    expect(ev).toHaveLength(1);
    expect(ev[0].message).toBe('path `src/auth/session.ts` matches sensitive pattern `auth`');
    expect(ev[0].weight).toBe(45);
  });
  it('flags dangerous code in added lines', () => {
    const ctx = fakeCtx(diffOf({ 'src/run.ts': { add: ["import { exec } from 'child_process';", 'exec(cmd);'] } }));
    const ev = sensitivePathSignal.run(ctx) as any[];
    expect(ev).toEqual([expect.objectContaining({ weight: 35, message: 'adds code matching `child_process`' })]);
  });
  it('is case-insensitive and honours extra config patterns', () => {
    const ctx = fakeCtx(diffOf({ 'src/Ledger.ts': { add: ['x'] } }));
    ctx.config.sensitivePaths.push('ledger');
    expect((sensitivePathSignal.run(ctx) as any[])[0].message).toContain('`ledger`');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run packages/core/test/signals-diff.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the four signals**

`packages/core/src/signals/size.ts`:
```ts
import type { Evidence, Signal } from '../types';

export const sizeSignal: Signal = {
  name: 'size',
  run(ctx) {
    const w = ctx.config.weights;
    const out: Evidence[] = [];
    for (const f of ctx.changeSet.files) {
      for (const h of f.hunks) {
        const n = h.added.length + h.removed.length;
        if (n < w.sizeMin) continue;
        out.push({
          signal: 'size', hunkId: h.id,
          weight: Math.min(w.sizeMax, Math.floor(n / 10) * w.sizePer10Lines),
          message: `hunk changes ${n} lines`,
        });
      }
    }
    return out;
  },
};
```

`packages/core/src/signals/diffusion.ts`:
```ts
import { posix } from 'node:path';
import type { Signal } from '../types';

export const diffusionSignal: Signal = {
  name: 'diffusion',
  run(ctx) {
    const files = ctx.changeSet.files;
    const dirs = new Set(files.map((f) => posix.dirname(f.path)));
    const { files: maxFiles, dirs: maxDirs } = ctx.config.diffusion;
    if (files.length < maxFiles && dirs.size < maxDirs) return [];
    return [{
      signal: 'diffusion', hunkId: '*', weight: ctx.config.weights.diffusion,
      message: `PR touches ${files.length} files across ${dirs.size} directories`,
    }];
  },
};
```

`packages/core/src/signals/dependency-change.ts`:
```ts
import { posix } from 'node:path';
import type { Evidence, Signal } from '../types';

const MANIFESTS = new Set(['package.json', 'pyproject.toml', 'Pipfile', 'go.mod', 'Cargo.toml', 'composer.json', 'Gemfile']);
const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'poetry.lock', 'uv.lock',
  'Pipfile.lock', 'Cargo.lock', 'go.sum', 'composer.lock', 'Gemfile.lock']);
const REQS = /^requirements[^/]*\.txt$/;

// "name": "^1.2.3"  |  name==1.2  |  name>=1.2  |  name = "1.2"
const JSON_DEP = /^\s*"(@?[\w./-]+)"\s*:\s*"([~^]?\d[^"]*)"/;
const META_KEYS = new Set(['version', 'node', 'npm', 'pnpm', 'yarn']);
const PY_DEP = /^\s*([A-Za-z0-9_.\-[\]]+)\s*(==|>=|~=|<=|>|<|=)\s*"?([\d][^"\s,;]*)/;

function major(v: string): number | undefined {
  const m = /(\d+)/.exec(v);
  return m ? Number(m[1]) : undefined;
}

function parseDeps(lines: string[], file: string): Map<string, string> {
  const re = file === 'package.json' || file === 'composer.json' ? JSON_DEP : PY_DEP;
  const out = new Map<string, string>();
  for (const l of lines) {
    const m = re.exec(l);
    if (!m) continue;
    if (re === JSON_DEP && META_KEYS.has(m[1]!)) continue; // package metadata, not a dependency
    if (re === JSON_DEP) out.set(m[1]!, m[2]!);
    else out.set(m[1]!, `${m[2]}${m[3]}`);
  }
  return out;
}

export const dependencyChangeSignal: Signal = {
  name: 'dependency-change',
  run(ctx) {
    const w = ctx.config.weights;
    const out: Evidence[] = [];
    for (const f of ctx.changeSet.files) {
      const base = posix.basename(f.path);
      if (LOCKFILES.has(base)) {
        const n = f.hunks.reduce((s, h) => s + h.added.length + h.removed.length, 0);
        const first = f.hunks[0];
        if (first) out.push({ signal: 'dependency-change', hunkId: first.id, weight: w.dependencyLockfile, message: `lockfile changed (${n} lines)` });
        continue;
      }
      if (!MANIFESTS.has(base) && !REQS.test(base)) continue;
      for (const h of f.hunks) {
        const added = parseDeps(h.added, base);
        const removed = parseDeps(h.removed, base);
        for (const [name, ver] of added) {
          const prev = removed.get(name);
          if (prev === undefined) {
            const label = base === 'package.json' || base === 'composer.json' ? `${name}@${ver}` : `${name}${ver}`;
            out.push({ signal: 'dependency-change', hunkId: h.id, weight: w.dependencyManifest, message: `adds dependency \`${label}\`` });
            continue;
          }
          const a = major(prev), b = major(ver);
          if (a !== undefined && b !== undefined && b !== a) {
            out.push({
              signal: 'dependency-change', hunkId: h.id, weight: w.dependencyManifest + w.dependencyMajor,
              message: `bumps \`${name}\` ${a} → ${b} (major)`,
            });
          }
        }
      }
    }
    return out;
  },
};
```

`packages/core/src/signals/sensitive-path.ts`:
```ts
import type { Evidence, Signal } from '../types';

export const sensitivePathSignal: Signal = {
  name: 'sensitive-path',
  run(ctx) {
    const w = ctx.config.weights;
    const pathRes = ctx.config.sensitivePaths.map((s) => ({ s, re: new RegExp(s, 'i') }));
    const codeRes = ctx.config.sensitiveCode.map((s) => ({ s, re: new RegExp(s, 'i') }));
    const out: Evidence[] = [];
    for (const f of ctx.changeSet.files) {
      const pathHit = pathRes.find(({ re }) => re.test(f.path));
      for (const h of f.hunks) {
        if (pathHit) {
          out.push({ signal: 'sensitive-path', hunkId: h.id, weight: w.sensitivePath,
            message: `path \`${f.path}\` matches sensitive pattern \`${pathHit.s}\`` });
        }
        const codeHit = codeRes.find(({ re }) => h.added.some((l) => re.test(l)));
        if (codeHit) {
          out.push({ signal: 'sensitive-path', hunkId: h.id, weight: w.sensitiveCode, ruleId: 'sensitive-code',
            message: `adds code matching \`${codeHit.s.replace(/\\b|\\\(|\\\./g, (m) => (m === '\\(' ? '(' : m === '\\.' ? '.' : ''))}\`` });
        }
      }
    }
    return out;
  },
};
```

The message for code hits shows the pattern source with regex escapes stripped (`child_process` stays `child_process`, `\bexec(Sync)?\(` becomes `exec(Sync)?(`). Only the first matching code pattern per hunk is reported, so a hunk gets one sensitive-code evidence at most.

- [ ] **Step 5: Run tests**

Run: `npx vitest run packages/core/test/signals-diff.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): size, diffusion, dependency-change and sensitive-path signals"
```

---

### Task 7: Test-gaming signal

**Files:**
- Create: `packages/core/src/signals/test-gaming.ts`
- Test: `packages/core/test/signals-test-gaming.test.ts`

**Interfaces:**
- Consumes: `Signal`, `Evidence` (Task 1), `fakeCtx`, `diffOf` (Task 6).
- Produces: `testGamingSignal: Signal` with ruleIds `test-file-deleted`, `skip-added`, `only-added`, `assertions-removed`, `matcher-weakened`.

Design note: the spec lists "AST for TS/JS/Py" as the source. v1 uses line-level regexes on the diff of **test files only**. That's deterministic and covers every rule listed above, and an AST adds nothing for these line-shaped patterns. The scope stays the same; only the mechanism is simpler.

- [ ] **Step 1: Write the failing test**

`packages/core/test/signals-test-gaming.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { testGamingSignal } from '../src/signals/test-gaming';
import { diffOf, fakeCtx } from './helpers/ctx';

const rules = (diff: string) => (testGamingSignal.run(fakeCtx(diff)) as any[]).map((e) => e.ruleId);

describe('test-gaming', () => {
  it('flags deleted test files', () => {
    expect(rules(diffOf({ 'src/a.test.ts': { status: 'deleted', del: ["it('x', () => {})"] } }))).toEqual(['test-file-deleted']);
  });
  it.each([
    ["  it.skip('works', () => {", 'skip-added'],
    ["  xit('works', () => {", 'skip-added'],
    ["  describe.skip('suite', () => {", 'skip-added'],
    ['@pytest.mark.skip(reason="flaky")', 'skip-added'],
    ['@pytest.mark.xfail', 'skip-added'],
    ["  it.only('works', () => {", 'only-added'],
    ["  fdescribe('suite', () => {", 'only-added'],
  ])('flags %s', (line, rule) => {
    expect(rules(diffOf({ 'test/a.test.ts': { add: [line] } }))).toEqual([rule]);
  });
  it('flags net assertion removal', () => {
    expect(rules(diffOf({ 'tests/test_api.py': { del: ['    assert r.status == 200', '    assert r.json() == {}'], add: ['    pass'] } })))
      .toEqual(['assertions-removed']);
  });
  it('flags weakened matchers', () => {
    expect(rules(diffOf({ 'a.spec.ts': { del: ['  expect(total).toBe(42);'], add: ['  expect(total).toBeDefined();'] } })))
      .toEqual(['matcher-weakened']);
  });
  it('ignores the same patterns in non-test files', () => {
    expect(rules(diffOf({ 'src/a.ts': { add: ["it.skip('x')"] } }))).toEqual([]);
  });
  it('does not flag rewritten assertions with equal counts', () => {
    expect(rules(diffOf({ 'a.test.ts': { del: ['expect(a).toBe(1);'], add: ['expect(a).toBe(2);'] } }))).toEqual([]);
  });
  it('uses the testGaming weight and a readable message', () => {
    const [e] = testGamingSignal.run(fakeCtx(diffOf({ 'a.test.ts': { add: ["it.only('x', () => {})"] } }))) as any[];
    expect(e.weight).toBe(70);
    expect(e.message).toBe('focuses a single test with `.only`/`fit` (other tests stop running)');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/core/test/signals-test-gaming.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/core/src/signals/test-gaming.ts`:
```ts
import type { Evidence, Signal } from '../types';

const SKIP = /\b(it|test|describe)\.skip\s*\(|\bx(it|describe|test)\s*\(|@pytest\.mark\.(skip|xfail)|\bpytest\.skip\s*\(|@unittest\.skip/;
const ONLY = /\b(it|test|describe)\.only\s*\(|\bf(it|describe)\s*\(/;
const ASSERT = /\bexpect\s*\(|\bassert\b|\bself\.assert\w+\s*\(|\bassert\w*\s*\(/;
const STRICT = /\.(toBe|toEqual|toStrictEqual|toHaveBeenCalledWith|toMatchObject)\s*\(\s*[^)\s]|\.toThrow\s*\(\s*[^)\s]|assert\s+[^=\n]+==/;
const WEAK = /\.(toBeDefined|toBeTruthy|toBeFalsy)\s*\(\s*\)|\.not\.toBeNull\s*\(\s*\)|\.toThrow\s*\(\s*\)|\.toHaveBeenCalled\s*\(\s*\)|^\s*assert\s+\w+\s*$/;

const MSG = {
  'test-file-deleted': (p: string) => `deletes test file \`${p}\``,
  'skip-added': () => 'skips a test (`.skip`/`xit`/`pytest.mark.skip`/`xfail`)',
  'only-added': () => 'focuses a single test with `.only`/`fit` (other tests stop running)',
  'assertions-removed': (n: string) => `removes ${n} more assertion(s) than it adds`,
  'matcher-weakened': () => 'replaces a strict assertion with a weaker one (e.g. `toBe(x)` → `toBeDefined()`)',
};

export const testGamingSignal: Signal = {
  name: 'test-gaming',
  run(ctx) {
    const weight = ctx.config.weights.testGaming;
    const out: Evidence[] = [];
    const push = (hunkId: string, ruleId: keyof typeof MSG, arg = '') =>
      out.push({ signal: 'test-gaming', hunkId, weight, ruleId, message: MSG[ruleId](arg) });

    for (const f of ctx.changeSet.files) {
      if (!f.isTest) continue;
      if (f.status === 'deleted') {
        const h = f.hunks[0];
        if (h) push(h.id, 'test-file-deleted', f.path);
        continue;
      }
      for (const h of f.hunks) {
        if (h.added.some((l) => SKIP.test(l))) push(h.id, 'skip-added');
        if (h.added.some((l) => ONLY.test(l))) push(h.id, 'only-added');
        const removedAsserts = h.removed.filter((l) => ASSERT.test(l)).length;
        const addedAsserts = h.added.filter((l) => ASSERT.test(l)).length;
        if (removedAsserts > addedAsserts) push(h.id, 'assertions-removed', String(removedAsserts - addedAsserts));
        else if (h.removed.some((l) => STRICT.test(l)) && h.added.some((l) => WEAK.test(l))) push(h.id, 'matcher-weakened');
      }
    }
    return out;
  },
};
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/core/test/signals-test-gaming.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): test-gaming signal"
```

---

### Task 8: Context-aware signals (blast-radius, untested-change, churn) with LCOV and symbols

**Files:**
- Create: `packages/core/src/symbols.ts`, `packages/core/src/lcov.ts`, `packages/core/src/signals/blast-radius.ts`, `packages/core/src/signals/untested-change.ts`, `packages/core/src/signals/churn.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/signals-context.test.ts`

**Interfaces:**
- Consumes: `Context`, `LcovData`, `Signal` (Task 1), `fakeCtx`, `diffOf` (Task 6).
- Produces: `declaredSymbols(lines: string[]): string[]`, `parseLcov(text: string, repoRoot: string): LcovData`, `blastRadiusSignal`, `untestedChangeSignal`, `churnSignal`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/signals-context.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { declaredSymbols } from '../src/symbols';
import { parseLcov } from '../src/lcov';
import { blastRadiusSignal } from '../src/signals/blast-radius';
import { untestedChangeSignal } from '../src/signals/untested-change';
import { churnSignal } from '../src/signals/churn';
import { diffOf, fakeCtx } from './helpers/ctx';

describe('declaredSymbols', () => {
  it('extracts TS/JS/Python declarations', () => {
    expect(declaredSymbols([
      'export async function login(user) {', 'class Session {', 'export const refreshToken = () => {',
      'def charge_card(amount):', 'async def refund():', 'let x = 1', '  return y;',
    ])).toEqual(['login', 'Session', 'refreshToken', 'charge_card', 'refund', 'x']);
  });
});

describe('parseLcov', () => {
  it('maps SF paths relative to repo root and reads DA hits', () => {
    const lcov = parseLcov('SF:/repo/src/a.ts\nDA:1,3\nDA:2,0\nend_of_record\nSF:src\\b.ts\nDA:5,1\nend_of_record\n', '/repo');
    expect(lcov.lines('src/a.ts')).toEqual(new Map([[1, 3], [2, 0]]));
    expect(lcov.lines('src/b.ts')?.get(5)).toBe(1);
    expect(lcov.lines('nope.ts')).toBeUndefined();
  });
});

describe('blast-radius', () => {
  it('scores by importer count with examples, capped', () => {
    const importers = Array.from({ length: 14 }, (_, i) => `src/m${i}.ts`);
    const ctx = fakeCtx(diffOf({ 'src/core.ts': { add: ['x'] } }), {
      importGraph: { importedBy: (p) => (p === 'src/core.ts' ? importers : []), importsOf: () => [] },
    });
    const [e] = blastRadiusSignal.run(ctx) as any[];
    expect(e.weight).toBe(30);
    expect(e.message).toBe('14 files import `src/core.ts` (e.g. src/m0.ts, src/m1.ts, src/m2.ts)');
  });
  it('is silent for leaf files', () => {
    expect(blastRadiusSignal.run(fakeCtx(diffOf({ 'a.ts': { add: ['x'] } })))).toEqual([]);
  });
});

describe('untested-change', () => {
  const diff = diffOf({ 'src/pay.ts': { add: ['export function charge(a) {', '  return a * 2;', '}'] } });
  it('flags code no test imports or mentions', () => {
    const ctx = fakeCtx(diff, { testFiles: ['src/other.test.ts'], readFile: () => "import { x } from './x';" });
    const [e] = untestedChangeSignal.run(ctx) as any[];
    expect(e.weight).toBe(25);
    expect(e.message).toBe('3 changed lines in `src/pay.ts`; no test file imports it or mentions `charge`');
  });
  it('is silent when a test imports the file', () => {
    const ctx = fakeCtx(diff, {
      testFiles: ['src/pay.test.ts'],
      importGraph: { importedBy: () => ['src/pay.test.ts'], importsOf: () => [] },
    });
    expect(untestedChangeSignal.run(ctx)).toEqual([]);
  });
  it('is silent when a test mentions a changed symbol', () => {
    const ctx = fakeCtx(diff, { testFiles: ['t/e2e.test.ts'], readFile: () => 'await charge(5)' });
    expect(untestedChangeSignal.run(ctx)).toEqual([]);
  });
  it('prefers LCOV when present', () => {
    const lcov = parseLcov('SF:src/pay.ts\nDA:1,0\nDA:2,0\nDA:3,0\nend_of_record\n', '/repo');
    const ctx = fakeCtx(diff, { lcov, importGraph: { importedBy: () => ['src/pay.test.ts'], importsOf: () => [] } });
    const [e] = untestedChangeSignal.run(ctx) as any[];
    expect(e.message).toBe('0 of 3 changed lines covered (lcov)');
  });
  it('skips test files, non-code files and deletions', () => {
    const ctx = fakeCtx(diffOf({ 'a.test.ts': { add: ['x'] }, 'README.md': { add: ['x'] }, 'b.ts': { del: ['x'] } }));
    expect(untestedChangeSignal.run(ctx)).toEqual([]);
  });
});

describe('churn', () => {
  it('flags hot files above the minimum', () => {
    const ctx = fakeCtx(diffOf({ 'hot.ts': { add: ['x'] }, 'cold.ts': { add: ['x'] } }), {
      git: { churn: (p) => (p === 'hot.ts' ? 7 : 1), shallow: false },
    });
    expect(churnSignal.run(ctx)).toEqual([expect.objectContaining({ weight: 14, message: 'file changed 7 times in the last 90 days' })]);
  });
  it('emits nothing on shallow clones', () => {
    const ctx = fakeCtx(diffOf({ 'hot.ts': { add: ['x'] } }), { git: { churn: () => 50, shallow: true } });
    expect(churnSignal.run(ctx)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/core/test/signals-context.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`packages/core/src/symbols.ts`:
```ts
const DECL = [
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /\bclass\s+([A-Za-z_$][\w$]*)/,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
];

export function declaredSymbols(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    for (const re of DECL) {
      const m = re.exec(l);
      if (m && !out.includes(m[1]!)) { out.push(m[1]!); break; }
    }
  }
  return out;
}
```

`packages/core/src/lcov.ts`:
```ts
import type { LcovData } from './types';

export function parseLcov(text: string, repoRoot: string): LcovData {
  const root = repoRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const files = new Map<string, Map<number, number>>();
  let current: Map<number, number> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('SF:')) {
      let p = raw.slice(3).replace(/\\/g, '/');
      if (p.toLowerCase().startsWith(root.toLowerCase() + '/')) p = p.slice(root.length + 1);
      p = p.replace(/^\.\//, '');
      current = new Map();
      files.set(p, current);
    } else if (raw.startsWith('DA:') && current) {
      const [line, hits] = raw.slice(3).split(',');
      current.set(Number(line), Number(hits));
    } else if (raw === 'end_of_record') {
      current = undefined;
    }
  }
  return { lines: (p) => files.get(p) };
}
```

`packages/core/src/signals/blast-radius.ts`:
```ts
import type { Evidence, Signal } from '../types';

export const blastRadiusSignal: Signal = {
  name: 'blast-radius',
  run(ctx) {
    const w = ctx.config.weights;
    const out: Evidence[] = [];
    for (const f of ctx.changeSet.files) {
      if (f.status === 'deleted') continue;
      const importers = ctx.importGraph.importedBy(f.path);
      if (importers.length === 0) continue;
      const weight = Math.min(w.blastRadiusMax, importers.length * w.blastRadiusPerImporter);
      const eg = importers.slice(0, 3).join(', ');
      const message = `${importers.length} file${importers.length === 1 ? '' : 's'} import${importers.length === 1 ? 's' : ''} \`${f.path}\` (e.g. ${eg})`;
      for (const h of f.hunks) out.push({ signal: 'blast-radius', hunkId: h.id, weight, message });
    }
    return out;
  },
};
```

`packages/core/src/signals/untested-change.ts`:
```ts
import type { Evidence, Signal } from '../types';
import { declaredSymbols } from '../symbols';

export const untestedChangeSignal: Signal = {
  name: 'untested-change',
  run(ctx) {
    const weight = ctx.config.weights.untestedChange;
    const out: Evidence[] = [];
    const testText = new Map<string, string>();
    const readTest = (p: string) => {
      if (!testText.has(p)) testText.set(p, ctx.readFile(p) ?? '');
      return testText.get(p)!;
    };
    for (const f of ctx.changeSet.files) {
      if (f.isTest || !f.language || f.status === 'deleted') continue;
      for (const h of f.hunks) {
        if (h.addedLines.length === 0) continue;
        const cov = ctx.lcov?.lines(f.path);
        if (cov) {
          const measured = h.addedLines.filter((l) => cov.has(l));
          if (measured.length === 0) continue;
          const covered = measured.filter((l) => (cov.get(l) ?? 0) > 0).length;
          if (covered === 0) {
            out.push({ signal: 'untested-change', hunkId: h.id, weight,
              message: `0 of ${measured.length} changed lines covered (lcov)` });
          }
          continue;
        }
        const importedByTest = ctx.importGraph.importedBy(f.path).some((p) => ctx.testFiles.includes(p) || /test|spec/i.test(p));
        if (importedByTest) continue;
        const symbols = declaredSymbols(h.added);
        const mentioned = symbols.some((s) => ctx.testFiles.some((t) => new RegExp(`\\b${s.replace(/\$/g, '\\$')}\\b`).test(readTest(t))));
        if (mentioned) continue;
        const what = symbols.length ? ` or mentions \`${symbols.slice(0, 3).join('`, `')}\`` : '';
        out.push({ signal: 'untested-change', hunkId: h.id, weight,
          message: `${h.addedLines.length} changed lines in \`${f.path}\`; no test file imports it${what}` });
      }
    }
    return out;
  },
};
```

`packages/core/src/signals/churn.ts`:
```ts
import type { Evidence, Signal } from '../types';

export const churnSignal: Signal = {
  name: 'churn',
  run(ctx) {
    if (ctx.git.shallow) return [];
    const w = ctx.config.weights;
    const out: Evidence[] = [];
    for (const f of ctx.changeSet.files) {
      const n = ctx.git.churn(f.path);
      if (n < w.churnMin) continue;
      const weight = Math.min(w.churnMax, n * w.churnPerChange);
      for (const h of f.hunks) {
        out.push({ signal: 'churn', hunkId: h.id, weight, message: `file changed ${n} times in the last ${ctx.config.churnDays} days` });
      }
    }
    return out;
  },
};
```

Append to `index.ts`: `export * from './symbols';` and `export * from './lcov';`

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/core/test/signals-context.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): blast-radius, untested-change (with lcov) and churn signals"
```

---

### Task 9: SARIF input and external-sarif signal

**Files:**
- Create: `packages/core/src/sarif-input.ts`, `packages/core/src/signals/external-sarif.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/sarif-input.test.ts`

**Interfaces:**
- Consumes: `SarifResult`, `Signal` (Task 1), `RadarError`, `fakeCtx`, `diffOf`.
- Produces: `normalizeUri(uri: string, repoRoot: string, baseIds?: Record<string, string>, baseId?: string): string`, `parseSarif(json: string, repoRoot: string): SarifResult[]` (throws `RadarError('BAD_INPUT')`), `externalSarifSignal: Signal`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/sarif-input.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeUri, parseSarif } from '../src/sarif-input';
import { externalSarifSignal } from '../src/signals/external-sarif';
import { RadarError } from '../src/errors';
import { diffOf, fakeCtx } from './helpers/ctx';

describe('normalizeUri', () => {
  it.each([
    ['src/a.ts', 'src/a.ts'],
    ['./src/a.ts', 'src/a.ts'],
    ['file:///repo/src/a.ts', 'src/a.ts'],
    ['file:///C:/work/repo/src/a.ts', 'src/a.ts'],
    ['C:\\work\\repo\\src\\a.ts', 'src/a.ts'],
    ['src/my%20file.ts', 'src/my file.ts'],
  ])('%s -> %s', (uri, want) => {
    const root = uri.includes('C:') ? 'C:\\work\\repo' : '/repo';
    expect(normalizeUri(uri, root)).toBe(want);
  });
  it('applies uriBaseId roots', () => {
    expect(normalizeUri('a.ts', '/repo', { SRCROOT: 'file:///repo/src/' }, 'SRCROOT')).toBe('src/a.ts');
  });
});

const semgrep = JSON.stringify({
  version: '2.1.0',
  runs: [{
    tool: { driver: { name: 'Semgrep' } },
    originalUriBaseIds: { SRCROOT: { uri: 'file:///repo/' } },
    results: [
      { ruleId: 'js.sqli', level: 'error', message: { text: 'SQL injection' },
        locations: [{ physicalLocation: { artifactLocation: { uri: 'src/db.ts', uriBaseId: 'SRCROOT' }, region: { startLine: 4, endLine: 5 } } }] },
      { ruleId: 'js.style', message: { text: 'style' },
        locations: [{ physicalLocation: { artifactLocation: { uri: 'src/db.ts' }, region: { startLine: 90 } } }] },
    ],
  }],
});

describe('parseSarif', () => {
  it('flattens results with tool, level default and line range', () => {
    expect(parseSarif(semgrep, '/repo')).toEqual([
      { tool: 'Semgrep', ruleId: 'js.sqli', level: 'error', message: 'SQL injection', file: 'src/db.ts', startLine: 4, endLine: 5 },
      { tool: 'Semgrep', ruleId: 'js.style', level: 'warning', message: 'style', file: 'src/db.ts', startLine: 90, endLine: 90 },
    ]);
  });
  it('throws BAD_INPUT on invalid JSON or missing runs', () => {
    expect(() => parseSarif('{', '/repo')).toThrow(RadarError);
    expect(() => parseSarif('{"version":"2.1.0"}', '/repo')).toThrow(/runs/);
  });
});

describe('external-sarif signal', () => {
  it('attaches findings that land inside a changed hunk', () => {
    const ctx = fakeCtx(diffOf({ 'src/db.ts': { add: ['a', 'b', 'c'], start: 3 } }), { sarif: parseSarif(semgrep, '/repo') });
    expect(externalSarifSignal.run(ctx)).toEqual([
      { signal: 'external-sarif', hunkId: 'src/db.ts:3-5', weight: 40, ruleId: 'js.sqli',
        message: 'Semgrep js.sqli: SQL injection', lines: { start: 4, end: 5 } },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/core/test/sarif-input.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`packages/core/src/sarif-input.ts`:
```ts
import type { SarifResult } from './types';
import { RadarError } from './errors';

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function stripFileScheme(uri: string): string {
  if (!uri.startsWith('file:')) return uri;
  let p = uri.replace(/^file:\/\//, '');
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // /C:/x -> C:/x
  return p;
}

export function normalizeUri(uri: string, repoRoot: string, baseIds: Record<string, string> = {}, baseId?: string): string {
  let u = uri;
  const base = baseId ? baseIds[baseId] : undefined;
  if (base && !/^(file:|[A-Za-z]:|\/)/.test(u)) u = (base.endsWith('/') ? base : base + '/') + u;
  let p = toPosix(decodeURIComponent(stripFileScheme(u)));
  const root = toPosix(repoRoot).replace(/\/+$/, '');
  if (p.toLowerCase().startsWith(root.toLowerCase() + '/')) p = p.slice(root.length + 1);
  return p.replace(/^\.\//, '');
}

interface RawResult {
  ruleId?: string;
  level?: SarifResult['level'];
  message?: { text?: string };
  locations?: { physicalLocation?: { artifactLocation?: { uri?: string; uriBaseId?: string }; region?: { startLine?: number; endLine?: number } } }[];
}

export function parseSarif(json: string, repoRoot: string): SarifResult[] {
  let doc: { runs?: { tool?: { driver?: { name?: string } }; originalUriBaseIds?: Record<string, { uri?: string }>; results?: RawResult[] }[] };
  try { doc = JSON.parse(json); } catch (e) {
    throw new RadarError('BAD_INPUT', `Invalid SARIF JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(doc.runs)) throw new RadarError('BAD_INPUT', 'SARIF file has no "runs" array.');
  const out: SarifResult[] = [];
  for (const run of doc.runs) {
    const tool = run.tool?.driver?.name ?? 'unknown';
    const baseIds = Object.fromEntries(Object.entries(run.originalUriBaseIds ?? {}).map(([k, v]) => [k, v.uri ?? '']));
    for (const r of run.results ?? []) {
      const loc = r.locations?.[0]?.physicalLocation;
      const uri = loc?.artifactLocation?.uri;
      if (!uri) continue;
      const startLine = loc?.region?.startLine ?? 1;
      out.push({
        tool,
        ruleId: r.ruleId ?? 'unknown',
        level: r.level ?? 'warning',
        message: r.message?.text ?? '',
        file: normalizeUri(uri, repoRoot, baseIds, loc?.artifactLocation?.uriBaseId),
        startLine,
        endLine: loc?.region?.endLine ?? startLine,
      });
    }
  }
  return out;
}
```


`packages/core/src/signals/external-sarif.ts`:
```ts
import type { Evidence, Signal } from '../types';

export const externalSarifSignal: Signal = {
  name: 'external-sarif',
  run(ctx) {
    const w = ctx.config.weights;
    const weightOf = { error: w.sarifError, warning: w.sarifWarning, note: w.sarifNote, none: w.sarifNote };
    const out: Evidence[] = [];
    for (const r of ctx.sarif) {
      const file = ctx.changeSet.files.find((f) => f.path === r.file);
      if (!file) continue;
      const hunk = file.hunks.find((h) => r.startLine <= h.newRange.end && r.endLine >= h.newRange.start);
      if (!hunk) continue;
      out.push({
        signal: 'external-sarif', hunkId: hunk.id, weight: weightOf[r.level], ruleId: r.ruleId,
        message: `${r.tool} ${r.ruleId}: ${r.message}`, lines: { start: r.startLine, end: r.endLine },
      });
    }
    return out;
  },
};
```

Append to `index.ts`: `export * from './sarif-input';`

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/core/test/sarif-input.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): SARIF input parsing and external-sarif signal"
```

---

### Task 10: Signal registry, scorer, and analyze() orchestrator

**Files:**
- Create: `packages/core/src/signals/index.ts`, `packages/core/src/scorer.ts`, `packages/core/src/analyze.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/scorer.test.ts`, `packages/core/test/analyze.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–9.
- Produces:
  - `defaultSignals: Signal[]`
  - `scoreHunks(hunks: Hunk[], evidence: Evidence[], cfg: Config): HunkRisk[]` (sorted by score desc, then file, then line)
  - `summarize(risks: HunkRisk[], skippedFiles: string[]): Summary`
  - `VERSION: string` (`'1.0.0'`)
  - `analyze(opts: AnalyzeOptions): Promise<RiskMap>` where
    `interface AnalyzeOptions { repoRoot: string; range?: string; sarifPaths?: string[]; lcovPath?: string; configPath?: string; useCache?: boolean; signals?: Signal[] }`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/scorer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { scoreHunks, summarize } from '../src/scorer';
import { DEFAULT_CONFIG } from '../src/config';
import type { Hunk } from '../src/types';

const hunk = (file: string, start: number, n = 10): Hunk => ({
  id: `${file}:${start}-${start + n - 1}`, file, oldRange: { start, end: start }, newRange: { start, end: start + n - 1 },
  added: Array(n).fill('x'), removed: [], addedLines: Array.from({ length: n }, (_, i) => start + i),
});

describe('scoreHunks', () => {
  const a = hunk('a.ts', 1), b = hunk('b.ts', 1), c = hunk('c.ts', 1);
  const ev = [
    { signal: 'test-gaming', hunkId: a.id, weight: 70, message: 'm1' },
    { signal: 'sensitive-path', hunkId: a.id, weight: 45, message: 'm2' },
    { signal: 'size', hunkId: b.id, weight: 30, message: 'm3' },
    { signal: 'diffusion', hunkId: '*', weight: 10, message: 'm4' },
  ];
  it('sums, caps at 100, applies PR-level evidence, sorts and tiers', () => {
    const r = scoreHunks([c, b, a], ev, DEFAULT_CONFIG);
    expect(r.map((x) => [x.hunk.file, x.score, x.tier])).toEqual([['a.ts', 100, 'P0'], ['b.ts', 40, 'P1'], ['c.ts', 10, 'P2']]);
    expect(r[0]!.evidence.map((e) => e.message)).toEqual(['m1', 'm2', 'm4']);
  });
  it('honours custom tiers', () => {
    const cfg = { ...DEFAULT_CONFIG, tiers: { p0: 101, p1: 50 } };
    expect(scoreHunks([a], ev, cfg)[0]!.tier).toBe('P1');
  });
});

describe('summarize', () => {
  it('counts tiers and estimates review minutes', () => {
    const risks = scoreHunks([hunk('a.ts', 1, 16), hunk('b.ts', 1, 40), hunk('c.ts', 1, 120)], [
      { signal: 's', hunkId: 'a.ts:1-16', weight: 80, message: '' },
      { signal: 's', hunkId: 'b.ts:1-40', weight: 50, message: '' },
    ], DEFAULT_CONFIG);
    // P0 16/8=2, P1 40/20=2, P2 120/60=2 -> 6
    expect(summarize(risks, ['logo.png'])).toEqual({ hunks: 3, p0: 1, p1: 1, p2: 1, estMinutes: 6, skippedFiles: ['logo.png'] });
  });
});
```

`packages/core/test/analyze.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from '../src/analyze';
import type { Signal } from '../src/types';
import { makeRepo } from './helpers/repo';

describe('analyze', () => {
  it('produces a ranked risk map end-to-end', async () => {
    const r = makeRepo();
    r.write({
      'src/auth/session.ts': 'export function check() { return true; }\n',
      'src/a.ts': "import { check } from './auth/session';\n",
      'src/b.ts': "import { check } from './auth/session';\n",
      'src/session.test.ts': "import { check } from './auth/session';\nit('works', () => { expect(check()).toBe(true); });\n",
      'README.md': '# x\n',
    });
    const base = r.commit('init');
    r.write({
      'src/auth/session.ts': 'export function check() { return false; }\n',
      'src/session.test.ts': "import { check } from './auth/session';\nit.skip('works', () => { expect(check()).toBe(true); });\n",
      'README.md': '# y\n',
    });
    const head = r.commit('change', { author: 'devin-ai-integration[bot]', email: 'bot@x' });
    const map = await analyze({ repoRoot: r.root, range: `${base}..${head}` });
    expect(map.hunks[0]!.tier).toBe('P0');
    expect(map.hunks.map((h) => h.hunk.file)).toContain('src/auth/session.ts');
    expect(map.hunks.find((h) => h.hunk.file === 'README.md')!.tier).toBe('P2');
    expect(map.meta.aiAuthored.likely).toBe(true);
    expect(map.meta.version).toBe('1.0.0');
    expect(map.summary.hunks).toBe(map.hunks.length);
  });

  it('returns an empty map for an empty diff', async () => {
    const r = makeRepo();
    r.write({ 'a.ts': '1\n' });
    const head = r.commit('init');
    const map = await analyze({ repoRoot: r.root, range: `${head}..${head}` });
    expect(map.hunks).toEqual([]);
    expect(map.summary).toMatchObject({ hunks: 0, p0: 0, p1: 0, p2: 0, estMinutes: 0 });
  });

  it('drops ignored files and lists binaries as skipped', async () => {
    const r = makeRepo();
    r.write({ 'a.ts': '1\n' });
    const base = r.commit('init');
    r.write({ 'dist/out.js': 'x\n' });
    writeFileSync(join(r.root, 'logo.png'), Buffer.from([0, 1, 2, 0, 255]));
    const head = r.commit('add');
    const map = await analyze({ repoRoot: r.root, range: `${base}..${head}` });
    expect(map.hunks).toEqual([]);
    expect(map.summary.skippedFiles).toEqual(['logo.png']);
  });

  it('isolates a failing signal and records a warning', async () => {
    const r = makeRepo();
    r.write({ 'a.ts': '1\n' });
    const base = r.commit('init');
    r.write({ 'a.ts': '2\n' });
    const head = r.commit('c');
    const boom: Signal = { name: 'boom', run: () => { throw new Error('kaput'); } };
    const ok: Signal = { name: 'ok', run: (ctx) => [{ signal: 'ok', hunkId: ctx.changeSet.files[0]!.hunks[0]!.id, weight: 5, message: 'fine' }] };
    const map = await analyze({ repoRoot: r.root, range: `${base}..${head}`, signals: [boom, ok] });
    expect(map.meta.warnings).toContain('signal boom skipped: kaput');
    expect(map.hunks[0]!.score).toBe(5);
  });

  it('reads SARIF and LCOV inputs', async () => {
    const r = makeRepo();
    r.write({ 'src/db.ts': 'a\n' });
    const base = r.commit('init');
    r.write({ 'src/db.ts': 'a\nb\n' });
    const head = r.commit('c');
    r.write({
      'semgrep.sarif': JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'Semgrep' } }, results: [
        { ruleId: 'x', level: 'error', message: { text: 'bad' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/db.ts' }, region: { startLine: 2 } } }] }] }] }),
      'lcov.info': 'SF:src/db.ts\nDA:2,0\nend_of_record\n',
    });
    const map = await analyze({ repoRoot: r.root, range: `${base}..${head}`, sarifPaths: ['semgrep.sarif'], lcovPath: 'lcov.info' });
    const signals = map.hunks[0]!.evidence.map((e) => e.signal);
    expect(signals).toContain('external-sarif');
    expect(signals).toContain('untested-change');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/core/test/scorer.test.ts packages/core/test/analyze.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`packages/core/src/signals/index.ts`:
```ts
import type { Signal } from '../types';
import { sensitivePathSignal } from './sensitive-path';
import { blastRadiusSignal } from './blast-radius';
import { untestedChangeSignal } from './untested-change';
import { testGamingSignal } from './test-gaming';
import { dependencyChangeSignal } from './dependency-change';
import { churnSignal } from './churn';
import { sizeSignal } from './size';
import { diffusionSignal } from './diffusion';
import { externalSarifSignal } from './external-sarif';

export const defaultSignals: Signal[] = [
  sensitivePathSignal, blastRadiusSignal, untestedChangeSignal, testGamingSignal,
  dependencyChangeSignal, churnSignal, sizeSignal, diffusionSignal, externalSarifSignal,
];

export {
  sensitivePathSignal, blastRadiusSignal, untestedChangeSignal, testGamingSignal,
  dependencyChangeSignal, churnSignal, sizeSignal, diffusionSignal, externalSarifSignal,
};
```

`packages/core/src/scorer.ts`:
```ts
import type { Config, Evidence, Hunk, HunkRisk, Summary } from './types';
import { tierFor } from './types';

export function scoreHunks(hunks: Hunk[], evidence: Evidence[], cfg: Config): HunkRisk[] {
  const global = evidence.filter((e) => e.hunkId === '*');
  const byHunk = new Map<string, Evidence[]>();
  for (const e of evidence) {
    if (e.hunkId === '*') continue;
    const list = byHunk.get(e.hunkId) ?? [];
    list.push(e);
    byHunk.set(e.hunkId, list);
  }
  return hunks
    .map((hunk) => {
      const ev = [...(byHunk.get(hunk.id) ?? []), ...global];
      const score = Math.min(100, ev.reduce((s, e) => s + e.weight, 0));
      return { hunk, score, tier: tierFor(score, cfg.tiers), evidence: ev };
    })
    .sort((a, b) => b.score - a.score || a.hunk.file.localeCompare(b.hunk.file) || a.hunk.newRange.start - b.hunk.newRange.start);
}

const RATE = { P0: 8, P1: 20, P2: 60 } as const; // changed lines per review-minute

export function summarize(risks: HunkRisk[], skippedFiles: string[]): Summary {
  const count = (t: string) => risks.filter((r) => r.tier === t).length;
  const minutes = risks.reduce((s, r) => s + (r.hunk.added.length + r.hunk.removed.length) / RATE[r.tier], 0);
  return { hunks: risks.length, p0: count('P0'), p1: count('P1'), p2: count('P2'), estMinutes: Math.ceil(minutes), skippedFiles };
}
```

`packages/core/src/analyze.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Context, Evidence, RiskMap, Signal } from './types';
import { getChangeSet } from './diff';
import { loadConfig, isIgnored } from './config';
import { buildGitHistory, detectAiAuthorship } from './history';
import { buildImportGraph } from './imports/graph';
import { parseSarif } from './sarif-input';
import { parseLcov } from './lcov';
import { isTestFile } from './lang';
import { git } from './git';
import { defaultSignals } from './signals/index';
import { scoreHunks, summarize } from './scorer';
import { RadarError } from './errors';

export const VERSION = '1.0.0';

export interface AnalyzeOptions {
  repoRoot: string;
  range?: string;
  sarifPaths?: string[];
  lcovPath?: string;
  configPath?: string;
  useCache?: boolean;
  signals?: Signal[];
}

const abs = (root: string, p: string) => (isAbsolute(p) ? p : join(root, p));

function readInput(root: string, p: string, kind: string): string {
  const full = abs(root, p);
  if (!existsSync(full)) throw new RadarError('BAD_INPUT', `${kind} file not found: ${p}`);
  return readFileSync(full, 'utf8');
}

export async function analyze(opts: AnalyzeOptions): Promise<RiskMap> {
  const { repoRoot } = opts;
  const config = loadConfig(repoRoot, opts.configPath);
  const raw = getChangeSet(repoRoot, opts.range);
  const warnings: string[] = [];

  const skippedFiles = raw.files.filter((f) => f.binary && !isIgnored(f.path, config)).map((f) => f.path);
  const changeSet = { ...raw, files: raw.files.filter((f) => !f.binary && !isIgnored(f.path, config)) };
  const hunks = changeSet.files.flatMap((f) => f.hunks);
  const aiAuthored = detectAiAuthorship(repoRoot, raw.base, raw.head);

  if (hunks.length === 0) {
    return { changeSet, hunks: [], summary: summarize([], skippedFiles), meta: { version: VERSION, warnings, aiAuthored } };
  }

  const history = buildGitHistory(repoRoot, raw.head, config.churnDays);
  if (history.shallow) warnings.push('shallow clone: churn signal disabled (use fetch-depth: 0)');

  const sarif = (opts.sarifPaths ?? []).flatMap((p) => parseSarif(readInput(repoRoot, p, 'SARIF'), repoRoot));
  const lcov = opts.lcovPath ? parseLcov(readInput(repoRoot, opts.lcovPath, 'LCOV'), repoRoot) : undefined;

  let importGraph: Context['importGraph'];
  try {
    importGraph = await buildImportGraph(repoRoot, raw.head, { useCache: opts.useCache ?? true });
  } catch (e) {
    warnings.push(`import graph unavailable: ${(e as Error).message}`);
    importGraph = { importedBy: () => [], importsOf: () => [] };
  }

  const tracked = git(repoRoot, ['ls-files', '-z']).split('\0').filter(Boolean);
  const ctx: Context = {
    repoRoot, changeSet, importGraph, git: history, sarif, lcov, config,
    testFiles: tracked.filter(isTestFile),
    readFile: (p) => { try { return readFileSync(join(repoRoot, p), 'utf8'); } catch { return undefined; } },
  };

  const evidence: Evidence[] = [];
  for (const s of opts.signals ?? defaultSignals) {
    try {
      evidence.push(...(await s.run(ctx)));
    } catch (e) {
      warnings.push(`signal ${s.name} skipped: ${(e as Error).message}`);
    }
  }

  const risks = scoreHunks(hunks, evidence, config);
  return { changeSet, hunks: risks, summary: summarize(risks, skippedFiles), meta: { version: VERSION, warnings, aiAuthored } };
}
```

Append to `index.ts`:
```ts
export * from './signals/index';
export * from './scorer';
export * from './analyze';
```

- [ ] **Step 4: Run all core tests**

Run: `npx vitest run packages/core`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): scorer and analyze orchestrator with signal isolation"
```

---

### Task 11: Reporters (terminal, markdown, JSON, SARIF)

**Files:**
- Create: `packages/core/src/reporters/terminal.ts`, `markdown.ts`, `json.ts`, `sarif.ts`, `index.ts`, `packages/core/test/fixtures/sarif-schema-2.1.0.json`
- Modify: `packages/core/package.json` (add `picocolors`), `packages/core/src/index.ts`
- Test: `packages/core/test/reporters.test.ts`

**Interfaces:**
- Consumes: `RiskMap`, `HunkRisk` (Task 1), `VERSION` (Task 10).
- Produces: `renderTerminal(map: RiskMap, opts?: { color?: boolean }): string`, `renderMarkdown(map: RiskMap, opts?: { marker?: boolean }): string`, `renderJson(map: RiskMap): string`, `renderSarif(map: RiskMap): string`, `render(map: RiskMap, format: Format): string`, `type Format = 'terminal' | 'md' | 'json' | 'sarif'`, `COMMENT_MARKER = '<!-- review-radar -->'`.

- [ ] **Step 1: Add dependency and schema fixture**

Run:
```bash
npm install picocolors@^1.1.1 -w @review-radar/core
curl -sSL https://json.schemastore.org/sarif-2.1.0.json -o packages/core/test/fixtures/sarif-schema-2.1.0.json
node -e "JSON.parse(require('fs').readFileSync('packages/core/test/fixtures/sarif-schema-2.1.0.json','utf8')); console.log('schema ok')"
```
Expected: `schema ok`.

- [ ] **Step 2: Write the failing test**

`packages/core/test/reporters.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { renderTerminal, renderMarkdown, renderJson, renderSarif, COMMENT_MARKER } from '../src/reporters/index';
import type { RiskMap, HunkRisk } from '../src/types';

const risk = (file: string, start: number, score: number, tier: 'P0' | 'P1' | 'P2', msgs: [string, number][]): HunkRisk => ({
  hunk: { id: `${file}:${start}-${start + 2}`, file, oldRange: { start, end: start }, newRange: { start, end: start + 2 },
    added: ['a', 'b', 'c'], removed: [], addedLines: [start, start + 1, start + 2] },
  score, tier, evidence: msgs.map(([message, weight], i) => ({ signal: i === 0 ? 'test-gaming' : 'size', hunkId: `${file}:${start}-${start + 2}`, weight, message })),
});

const MAP: RiskMap = {
  changeSet: { base: 'aaa', head: 'bbb', files: [] },
  hunks: [
    risk('src/auth.ts', 10, 85, 'P0', [['skips a test', 70], ['hunk changes 45 lines', 15]]),
    risk('src/api.ts', 3, 45, 'P1', [['3 files import `src/api.ts`', 45]]),
    risk('README.md', 1, 0, 'P2', []),
    risk('old.test.ts', 0, 70, 'P0', [['deletes test file `old.test.ts`', 70]]),
  ],
  summary: { hunks: 4, p0: 2, p1: 1, p2: 1, estMinutes: 3, skippedFiles: [] },
  meta: { version: '1.0.0', warnings: ['shallow clone: churn signal disabled (use fetch-depth: 0)'], aiAuthored: { likely: true, reasons: ['commit author devin[bot]'] } },
};

describe('terminal', () => {
  it('lists P0 first with evidence and a summary footer (no color)', () => {
    const out = renderTerminal(MAP, { color: false });
    expect(out.indexOf('src/auth.ts:10-12')).toBeLessThan(out.indexOf('src/api.ts:3-5'));
    expect(out).toContain('P0   85');
    expect(out).toContain('    • skips a test (+70)');
    expect(out).toContain('4 hunks · 2 P0 · 1 P1 · 1 P2 · est. review time 3 min');
    expect(out).toContain('⚠ shallow clone');
    expect(out).toContain('AI-authored (likely): commit author devin[bot]');
  });
  it('says so when nothing changed', () => {
    const empty = { ...MAP, hunks: [], summary: { hunks: 0, p0: 0, p1: 0, p2: 0, estMinutes: 0, skippedFiles: [] } };
    expect(renderTerminal(empty, { color: false })).toContain('No reviewable changes');
  });
});

describe('markdown', () => {
  it('has marker, badge, heatmap table and collapsed evidence; P2 summarised', () => {
    const md = renderMarkdown(MAP, { marker: true });
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
    expect(md).toContain('🤖 **Likely AI-authored**');
    expect(md).toContain('| 🔴 P0 | 85 | `src/auth.ts:10-12` |');
    expect(md).toContain('<details><summary><code>src/auth.ts:10-12</code>');
    expect(md).toContain('- skips a test (+70)');
    expect(md).toContain('1 P2 hunk(s) hidden');
    expect(md).not.toContain('`README.md:1-3`');
  });
});

describe('json', () => {
  it('round-trips the risk map', () => {
    expect(JSON.parse(renderJson(MAP))).toEqual(MAP);
  });
});

describe('sarif', () => {
  const doc = JSON.parse(renderSarif(MAP));
  it('validates against the SARIF 2.1.0 schema', () => {
    const schema = JSON.parse(readFileSync(new URL('./fixtures/sarif-schema-2.1.0.json', import.meta.url), 'utf8'));
    const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
    const ok = ajv.validate(schema, doc);
    expect(ajv.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
  it('emits only P0/P1 with levels, top signal as ruleId, clamped start line', () => {
    const results = doc.runs[0].results;
    expect(results).toHaveLength(3);
    expect(results.map((r: any) => [r.ruleId, r.level])).toEqual([
      ['test-gaming', 'error'],    // src/auth.ts: highest-weight evidence
      ['test-gaming', 'warning'],  // src/api.ts: the fixture helper labels the first evidence 'test-gaming'
      ['test-gaming', 'error'],    // old.test.ts
    ]);
    expect(results[0].message.text).toBe('skips a test; hunk changes 45 lines (score 85, P0)');
    const del = results.find((r: any) => r.locations[0].physicalLocation.artifactLocation.uri === 'old.test.ts');
    expect(del.locations[0].physicalLocation.region.startLine).toBe(1);
    expect(doc.runs[0].tool.driver.name).toBe('review-radar');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run packages/core/test/reporters.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`packages/core/src/reporters/terminal.ts`:
```ts
import pc from 'picocolors';
import type { RiskMap, Tier } from '../types';

export function renderTerminal(map: RiskMap, opts: { color?: boolean } = {}): string {
  const c = pc.createColors(opts.color ?? pc.isColorSupported);
  const tierColor: Record<Tier, (s: string) => string> = { P0: c.red, P1: c.yellow, P2: c.dim };
  const lines: string[] = [];
  if (map.meta.aiAuthored.likely) lines.push(c.magenta(`AI-authored (likely): ${map.meta.aiAuthored.reasons.join('; ')}`), '');
  if (map.hunks.length === 0) {
    lines.push('No reviewable changes.');
  }
  for (const r of map.hunks) {
    const h = r.hunk;
    const bar = '█'.repeat(Math.round(r.score / 10)).padEnd(10, '·');
    const col = tierColor[r.tier];
    lines.push(`${col(`${r.tier}  ${String(r.score).padStart(3)}`)}  ${col(bar)}  ${c.bold(`${h.file}:${h.newRange.start}-${h.newRange.end}`)}`);
    for (const e of r.evidence) lines.push(`    • ${e.message} (+${e.weight})`);
  }
  const s = map.summary;
  lines.push('', `${s.hunks} hunks · ${s.p0} P0 · ${s.p1} P1 · ${s.p2} P2 · est. review time ${s.estMinutes} min`);
  if (s.skippedFiles.length) lines.push(c.dim(`skipped (binary): ${s.skippedFiles.join(', ')}`));
  for (const w of map.meta.warnings) lines.push(c.yellow(`⚠ ${w}`));
  return lines.join('\n') + '\n';
}
```

`packages/core/src/reporters/markdown.ts`:
```ts
import type { RiskMap, Tier } from '../types';

export const COMMENT_MARKER = '<!-- review-radar -->';
const ICON: Record<Tier, string> = { P0: '🔴', P1: '🟡', P2: '⚪' };

export function renderMarkdown(map: RiskMap, opts: { marker?: boolean } = {}): string {
  const out: string[] = [];
  if (opts.marker) out.push(COMMENT_MARKER);
  out.push('## 📡 Review Radar');
  if (map.meta.aiAuthored.likely) out.push(`🤖 **Likely AI-authored**: ${map.meta.aiAuthored.reasons.join('; ')}`);
  const s = map.summary;
  out.push('', `**${s.hunks} hunks** · ${s.p0} P0 · ${s.p1} P1 · ${s.p2} P2 · est. review time **${s.estMinutes} min**`);
  if (map.hunks.length === 0) {
    out.push('', 'No reviewable changes.');
  } else {
    const shown = map.hunks.filter((r) => r.tier !== 'P2');
    if (shown.length) {
      out.push('', '| Tier | Score | Where |', '|---|---|---|');
      for (const r of shown) out.push(`| ${ICON[r.tier]} ${r.tier} | ${r.score} | \`${r.hunk.file}:${r.hunk.newRange.start}-${r.hunk.newRange.end}\` |`);
      out.push('');
      for (const r of shown) {
        out.push(`<details><summary><code>${r.hunk.file}:${r.hunk.newRange.start}-${r.hunk.newRange.end}</code>: ${r.tier} (${r.score})</summary>`, '');
        for (const e of r.evidence) out.push(`- ${e.message} (+${e.weight})`);
        out.push('', '</details>');
      }
    }
    if (s.p2) out.push('', `_${s.p2} P2 hunk(s) hidden: low risk, skim only._`);
  }
  for (const w of map.meta.warnings) out.push('', `> ⚠️ ${w}`);
  out.push('', `<sub>review-radar v${map.meta.version} · deterministic, no LLM · <a href="https://github.com/44dummies/review-radar">docs</a></sub>`);
  return out.join('\n') + '\n';
}
```

`packages/core/src/reporters/json.ts`:
```ts
import type { RiskMap } from '../types';
export const renderJson = (map: RiskMap): string => JSON.stringify(map, null, 2) + '\n';
```

`packages/core/src/reporters/sarif.ts`:
```ts
import type { RiskMap } from '../types';

const RULE_TEXT: Record<string, string> = {
  'sensitive-path': 'Change touches a sensitive path or dangerous API',
  'blast-radius': 'Changed module is imported by many files',
  'untested-change': 'Changed code has no detectable test coverage',
  'test-gaming': 'Tests were skipped, deleted or weakened',
  'dependency-change': 'Dependencies were added or bumped',
  churn: 'File changes frequently',
  size: 'Large hunk',
  diffusion: 'PR is spread across many files',
  'external-sarif': 'Finding from another scanner',
};

export function renderSarif(map: RiskMap): string {
  const flagged = map.hunks.filter((r) => r.tier !== 'P2');
  const top = (r: (typeof flagged)[number]) => [...r.evidence].sort((a, b) => b.weight - a.weight)[0]?.signal ?? 'size';
  const ruleIds = [...new Set(flagged.map(top))];
  const doc = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: {
        name: 'review-radar', version: map.meta.version, informationUri: 'https://github.com/44dummies/review-radar',
        rules: ruleIds.map((id) => ({ id, shortDescription: { text: RULE_TEXT[id] ?? id } })),
      } },
      results: flagged.map((r) => ({
        ruleId: top(r),
        level: r.tier === 'P0' ? 'error' : 'warning',
        message: { text: `${r.evidence.map((e) => e.message).join('; ')} (score ${r.score}, ${r.tier})` },
        locations: [{ physicalLocation: {
          artifactLocation: { uri: r.hunk.file },
          region: { startLine: Math.max(1, r.hunk.newRange.start), endLine: Math.max(1, r.hunk.newRange.end) },
        } }],
      })),
    }],
  };
  return JSON.stringify(doc, null, 2) + '\n';
}
```

`packages/core/src/reporters/index.ts`:
```ts
import type { RiskMap } from '../types';
import { renderTerminal } from './terminal';
import { renderMarkdown, COMMENT_MARKER } from './markdown';
import { renderJson } from './json';
import { renderSarif } from './sarif';

export type Format = 'terminal' | 'md' | 'json' | 'sarif';
export const FORMATS: Format[] = ['terminal', 'md', 'json', 'sarif'];

export function render(map: RiskMap, format: Format, opts: { color?: boolean } = {}): string {
  switch (format) {
    case 'terminal': return renderTerminal(map, opts);
    case 'md': return renderMarkdown(map);
    case 'json': return renderJson(map);
    case 'sarif': return renderSarif(map);
  }
}

export { renderTerminal, renderMarkdown, renderJson, renderSarif, COMMENT_MARKER };
```

Append to `packages/core/src/index.ts`: `export * from './reporters/index';`

- [ ] **Step 5: Run tests**

Run: `npx vitest run packages/core/test/reporters.test.ts`
Expected: all pass. If ajv reports `$schema` meta errors, add `ajv.addMetaSchema` for draft-07 (`import draft7 from 'ajv/dist/refs/json-schema-draft-07.json'`). Ajv 8 includes draft-07 by default, so this usually isn't needed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): terminal, markdown, json and sarif reporters"
```

---

### Task 12: CLI and bundling

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/src/cli.ts`, `packages/cli/README.md` (copied from root at publish), `scripts/bundle.mjs`
- Test: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `analyze`, `AnalyzeOptions`, `render`, `FORMATS`, `Format`, `RadarError`, `VERSION` (core).
- Produces: `main(argv: string[], io: { stdout: (s: string) => void; stderr: (s: string) => void; cwd: string }): Promise<number>` (the exit code), and the binary `review-radar`.

- [ ] **Step 1: CLI package manifest**

`packages/cli/package.json`:
```json
{
  "name": "review-radar",
  "version": "1.0.0",
  "description": "Shows which lines of an AI-written PR a human must review, and why. Deterministic, offline, no LLM.",
  "type": "module",
  "bin": { "review-radar": "dist/cli.mjs" },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "keywords": ["code-review", "ai", "pull-request", "sarif", "risk", "github-action", "llm", "agents"],
  "repository": { "type": "git", "url": "git+https://github.com/44dummies/review-radar.git" },
  "license": "MIT",
  "dependencies": { "@review-radar/core": "1.0.0" }
}
```
Note: `@review-radar/core` is private, so esbuild bundles it into `dist/cli.mjs`. In Step 6, change `dependencies` to `{}` in the published manifest, because the bundle is self-contained.

Run: `npm install`

- [ ] **Step 2: Write the failing test**

`packages/cli/test/cli.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { main } from '../src/cli';
import { makeRepo } from '../../core/test/helpers/repo';

function run(argv: string[], cwd: string) {
  let out = '', err = '';
  return main(argv, { stdout: (s) => (out += s), stderr: (s) => (err += s), cwd }).then((code) => ({ code, out, err }));
}

function fixture() {
  const r = makeRepo();
  r.write({ 'src/auth.ts': 'export const a = 1;\n', 'src/a.test.ts': "it('a', () => {});\n" });
  const base = r.commit('init');
  r.write({ 'src/auth.ts': 'export const a = 2;\n', 'src/a.test.ts': "it.skip('a', () => {});\n" });
  const head = r.commit('change');
  return { r, range: `${base}..${head}` };
}

describe('cli', () => {
  it('prints the terminal report and exits 0 by default', async () => {
    const { r, range } = fixture();
    const res = await run([range, '--no-color'], r.root);
    expect(res.code).toBe(0);
    expect(res.out).toContain('src/a.test.ts');
    expect(res.out).toContain('est. review time');
  });
  it('exits 1 with --fail-on P0 when a P0 exists', async () => {
    const { r, range } = fixture();
    expect((await run([range, '--fail-on', 'P0', '--no-color'], r.root)).code).toBe(1);
  });
  it('writes json/sarif/md to --out', async () => {
    const { r, range } = fixture();
    const res = await run([range, '--format', 'sarif', '--out', 'rr.sarif'], r.root);
    expect(res.code).toBe(0);
    const { readFileSync } = await import('node:fs');
    expect(JSON.parse(readFileSync(`${r.root}/rr.sarif`, 'utf8')).version).toBe('2.1.0');
  });
  it('exits 2 with a helpful message on a bad base', async () => {
    const { r } = fixture();
    const res = await run(['nope..HEAD'], r.root);
    expect(res.code).toBe(2);
    expect(res.err).toContain('fetch-depth: 0');
  });
  it('exits 2 on unknown format or flag', async () => {
    const { r } = fixture();
    expect((await run(['--format', 'xml'], r.root)).code).toBe(2);
    expect((await run(['--bogus'], r.root)).code).toBe(2);
  });
  it('prints version and help', async () => {
    const { r } = fixture();
    expect((await run(['--version'], r.root)).out.trim()).toBe('1.0.0');
    expect((await run(['--help'], r.root)).out).toContain('Usage: review-radar');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run packages/cli`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the CLI**

`packages/cli/src/cli.ts`:
```ts
#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyze, render, FORMATS, RadarError, VERSION, type Format } from '@review-radar/core';

const HELP = `Usage: review-radar [<base>..<head>] [options]

Shows which hunks of a change need human review, and why.

Options:
  --sarif <file>     Merge findings from another scanner (repeatable)
  --lcov <file>      Use an LCOV coverage report for untested-change
  --format <f>       terminal | md | json | sarif   (default: terminal)
  --out <file>       Write the report to a file instead of stdout
  --fail-on <tier>   Exit 1 if any hunk is at or above P0 | P1
  --config <file>    Config file (default: .reviewradar.yml)
  --no-cache         Rebuild the import graph
  --no-color         Disable colors
  -v, --version      Print version
  -h, --help         Print this help
`;

interface IO { stdout: (s: string) => void; stderr: (s: string) => void; cwd: string }

export async function main(argv: string[], io: IO): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv, allowPositionals: true, strict: true,
      options: {
        sarif: { type: 'string', multiple: true }, lcov: { type: 'string' }, format: { type: 'string', default: 'terminal' },
        out: { type: 'string' }, 'fail-on': { type: 'string' }, config: { type: 'string' },
        'no-cache': { type: 'boolean' }, 'no-color': { type: 'boolean' },
        version: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    io.stderr(`review-radar: ${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values: v, positionals } = parsed;
  if (v.help) { io.stdout(HELP); return 0; }
  if (v.version) { io.stdout(`${VERSION}\n`); return 0; }
  const format = v.format as Format;
  if (!FORMATS.includes(format)) { io.stderr(`review-radar: unknown --format "${v.format}" (use ${FORMATS.join(', ')})\n`); return 2; }
  const failOn = v['fail-on'];
  if (failOn && failOn !== 'P0' && failOn !== 'P1') { io.stderr('review-radar: --fail-on must be P0 or P1\n'); return 2; }

  try {
    const map = await analyze({
      repoRoot: io.cwd, range: positionals[0], sarifPaths: v.sarif, lcovPath: v.lcov,
      configPath: v.config, useCache: !v['no-cache'],
    });
    const text = render(map, format, { color: !v['no-color'] && !v.out });
    if (v.out) writeFileSync(isAbsolute(v.out) ? v.out : join(io.cwd, v.out), text);
    else io.stdout(text);
    if (failOn === 'P0' && map.summary.p0 > 0) return 1;
    if (failOn === 'P1' && map.summary.p0 + map.summary.p1 > 0) return 1;
    return 0;
  } catch (e) {
    const msg = e instanceof RadarError ? e.message : (e as Error).stack ?? String(e);
    io.stderr(`review-radar: ${msg}\n`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s), cwd: process.cwd(),
  }).then((code) => { process.exitCode = code; });
}
```

Note: `parseArgs` with `strict: true` treats `--no-cache` and `--no-color` as plain boolean names, which is why they're declared literally.

- [ ] **Step 5: Run tests**

Run: `npx vitest run packages/cli`
Expected: all pass.

- [ ] **Step 6: Bundle script and smoke test**

`scripts/bundle.mjs`:
```js
// Bundles an entry into a single ESM file and copies the wasm assets next to it.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
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
}
```

The bundled `assets.ts` resolves `join(here, 'grammars', file)` with `here` = the `dist/` folder of the `.mjs`, which is where this script copies the files.

Run:
```bash
node scripts/bundle.mjs cli
node packages/cli/dist/cli.mjs --version
node packages/cli/dist/cli.mjs HEAD~1..HEAD --no-color
```
Expected: `1.0.0`, then a report for the last commit of this repo with no "asset not found" errors.

Then set `"dependencies": {}` in `packages/cli/package.json` and run `npm install` again.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(cli): review-radar CLI with exit codes and esbuild bundle"
```

---

### Task 13: GitHub Action (composite) with sticky comment, summary, annotations, SARIF upload

**Files:**
- Create: `packages/action/package.json`, `packages/action/src/comment.ts`, `packages/action/src/main.ts`, `action.yml`
- Generated: `dist/index.mjs`, `dist/grammars/*.wasm` (committed)
- Test: `packages/action/test/comment.test.ts`, `packages/action/test/annotations.test.ts`

**Interfaces:**
- Consumes: `analyze`, `renderMarkdown`, `renderSarif`, `COMMENT_MARKER`, `RiskMap` (core).
- Produces:
  - `upsertComment(api: CommentApi, target: { owner: string; repo: string; issue_number: number }, body: string): Promise<'created' | 'updated'>`
  - `interface CommentApi { list(t): Promise<{ id: number; body?: string | null }[]>; create(t, body): Promise<void>; update(t, id, body): Promise<void> }`
  - `topAnnotations(map: RiskMap, max?: number): { file: string; startLine: number; endLine: number; title: string; message: string }[]`

- [ ] **Step 1: Manifest**

`packages/action/package.json`:
```json
{
  "name": "@review-radar/action",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@actions/core": "^3.0.1",
    "@actions/github": "^9.1.1",
    "@review-radar/core": "1.0.0"
  }
}
```
Run: `npm install`

- [ ] **Step 2: Write the failing tests**

`packages/action/test/comment.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { upsertComment, type CommentApi } from '../src/comment';

function fakeApi(existing: { id: number; body: string }[]) {
  const calls: string[] = [];
  const api: CommentApi = {
    list: async () => existing,
    create: async (_t, body) => { calls.push(`create:${body}`); },
    update: async (_t, id, body) => { calls.push(`update:${id}:${body}`); },
  };
  return { api, calls };
}
const t = { owner: 'o', repo: 'r', issue_number: 1 };

describe('upsertComment', () => {
  it('creates when no marked comment exists', async () => {
    const { api, calls } = fakeApi([{ id: 5, body: 'hello' }]);
    expect(await upsertComment(api, t, '<!-- review-radar -->\nnew')).toBe('created');
    expect(calls).toEqual(['create:<!-- review-radar -->\nnew']);
  });
  it('updates the marked comment instead of posting again', async () => {
    const { api, calls } = fakeApi([{ id: 5, body: 'hello' }, { id: 9, body: '<!-- review-radar -->\nold' }]);
    expect(await upsertComment(api, t, '<!-- review-radar -->\nnew')).toBe('updated');
    expect(calls).toEqual(['update:9:<!-- review-radar -->\nnew']);
  });
});
```

`packages/action/test/annotations.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { topAnnotations } from '../src/comment';
import type { RiskMap } from '@review-radar/core';

const mk = (i: number, tier: 'P0' | 'P1', start = i + 1) => ({
  hunk: { id: `f${i}.ts:${start}-${start}`, file: `f${i}.ts`, oldRange: { start, end: start }, newRange: { start, end: start }, added: ['x'], removed: [], addedLines: [start] },
  score: tier === 'P0' ? 90 : 50, tier, evidence: [{ signal: 's', hunkId: '', weight: 90, message: `why ${i}` }],
});

describe('topAnnotations', () => {
  it('returns at most 10 P0 hunks, clamps line 0 to 1', () => {
    const map = { hunks: [mk(0, 'P0', 0), ...Array.from({ length: 14 }, (_, i) => mk(i + 1, 'P0')), mk(99, 'P1')] } as unknown as RiskMap;
    const a = topAnnotations(map);
    expect(a).toHaveLength(10);
    expect(a[0]).toEqual({ file: 'f0.ts', startLine: 1, endLine: 1, title: 'Review Radar P0 (90)', message: 'why 0' });
    expect(a.every((x) => !x.file.startsWith('f99'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run packages/action`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement comment helpers**

`packages/action/src/comment.ts`:
```ts
import { COMMENT_MARKER, type RiskMap } from '@review-radar/core';

export interface Target { owner: string; repo: string; issue_number: number }
export interface CommentApi {
  list(t: Target): Promise<{ id: number; body?: string | null }[]>;
  create(t: Target, body: string): Promise<void>;
  update(t: Target, id: number, body: string): Promise<void>;
}

export async function upsertComment(api: CommentApi, t: Target, body: string): Promise<'created' | 'updated'> {
  const existing = (await api.list(t)).find((c) => c.body?.includes(COMMENT_MARKER));
  if (existing) { await api.update(t, existing.id, body); return 'updated'; }
  await api.create(t, body);
  return 'created';
}

export function topAnnotations(map: RiskMap, max = 10) {
  return map.hunks
    .filter((r) => r.tier === 'P0')
    .slice(0, max)
    .map((r) => ({
      file: r.hunk.file,
      startLine: Math.max(1, r.hunk.newRange.start),
      endLine: Math.max(1, r.hunk.newRange.end),
      title: `Review Radar ${r.tier} (${r.score})`,
      message: r.evidence.map((e) => e.message).join('\n'),
    }));
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run packages/action`
Expected: 3 passed.

- [ ] **Step 6: Implement main and action.yml**

`packages/action/src/main.ts`:
```ts
import * as core from '@actions/core';
import * as github from '@actions/github';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, renderMarkdown, renderSarif } from '@review-radar/core';
import { upsertComment, topAnnotations, type CommentApi } from './comment';

async function run(): Promise<void> {
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const sarifPaths = core.getInput('sarif').split(',').map((s) => s.trim()).filter(Boolean);
  const lcovPath = core.getInput('lcov') || undefined;
  const failOn = core.getInput('fail-on');
  const token = core.getInput('github-token');
  const pr = github.context.payload.pull_request as { number: number; base: { sha: string }; head: { sha: string } } | undefined;

  const range = pr ? `${pr.base.sha}..${pr.head.sha}` : undefined;
  const map = await analyze({ repoRoot: workspace, range, sarifPaths, lcovPath, useCache: false });
  const md = renderMarkdown(map, { marker: true });

  await core.summary.addRaw(md).write();

  for (const a of topAnnotations(map)) {
    core.error(a.message, { file: a.file, startLine: a.startLine, endLine: a.endLine, title: a.title });
  }

  const sarifFile = join(process.env.RUNNER_TEMP ?? workspace, 'review-radar.sarif');
  writeFileSync(sarifFile, renderSarif(map));
  core.setOutput('sarif-file', sarifFile);
  core.setOutput('p0', String(map.summary.p0));
  core.setOutput('p1', String(map.summary.p1));

  if (pr && token) {
    const octokit = github.getOctokit(token);
    const api: CommentApi = {
      list: async (t) => octokit.paginate(octokit.rest.issues.listComments, { ...t, per_page: 100 }),
      create: async (t, body) => { await octokit.rest.issues.createComment({ ...t, body }); },
      update: async (t, id, body) => { await octokit.rest.issues.updateComment({ owner: t.owner, repo: t.repo, comment_id: id, body }); },
    };
    try {
      const result = await upsertComment(api, { ...github.context.repo, issue_number: pr.number }, md);
      core.info(`review-radar: PR comment ${result}`);
    } catch (e) {
      core.warning(`review-radar: could not write PR comment (${(e as Error).message}). Grant "pull-requests: write". The job summary still has the report.`);
    }
  }

  if (failOn === 'P0' && map.summary.p0 > 0) core.setFailed(`${map.summary.p0} P0 hunk(s) need review`);
  if (failOn === 'P1' && map.summary.p0 + map.summary.p1 > 0) core.setFailed(`${map.summary.p0 + map.summary.p1} P0/P1 hunk(s) need review`);
}

run().catch((e) => core.setFailed((e as Error).message));
```

`action.yml`:
```yaml
name: Review Radar
description: Shows which lines of a PR a human must review, and why. Deterministic, offline, no LLM.
author: 44dummies
branding:
  icon: radio
  color: red
inputs:
  sarif:
    description: Comma-separated SARIF files from other scanners (Semgrep, CodeQL, noskip, open-code-review)
    required: false
    default: ''
  lcov:
    description: Path to an LCOV coverage report
    required: false
    default: ''
  fail-on:
    description: Fail the job if any hunk is at or above P0 or P1
    required: false
    default: ''
  upload-sarif:
    description: Upload results to GitHub code scanning (free on public repos)
    required: false
    default: 'true'
  github-token:
    description: Token used to post the PR comment
    required: false
    default: ${{ github.token }}
outputs:
  sarif-file:
    description: Path to the generated SARIF file
    value: ${{ steps.radar.outputs.sarif-file }}
  p0:
    description: Number of P0 hunks
    value: ${{ steps.radar.outputs.p0 }}
  p1:
    description: Number of P1 hunks
    value: ${{ steps.radar.outputs.p1 }}
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: 20
    - id: radar
      shell: bash
      run: node "${{ github.action_path }}/dist/index.mjs"
      env:
        INPUT_SARIF: ${{ inputs.sarif }}
        INPUT_LCOV: ${{ inputs.lcov }}
        INPUT_FAIL-ON: ${{ inputs.fail-on }}
        INPUT_GITHUB-TOKEN: ${{ inputs.github-token }}
    - if: ${{ always() && inputs.upload-sarif == 'true' && steps.radar.outputs.sarif-file != '' }}
      uses: github/codeql-action/upload-sarif@v4
      continue-on-error: true
      with:
        sarif_file: ${{ steps.radar.outputs.sarif-file }}
        category: review-radar
```

Note: composite actions don't pass `inputs` as `INPUT_*` env vars automatically, so the `env:` block maps them by hand. `@actions/core.getInput('fail-on')` reads `INPUT_FAIL-ON`. Note too that `setFailed` in the radar step stops the SARIF upload step unless `always()` is used, which is why the `if:` includes it.

Run:
```bash
node scripts/bundle.mjs dist/index
ls dist dist/grammars
```
Expected: `dist/index.mjs` and `dist/grammars/` with 5 `.wasm` files (4 grammars + `web-tree-sitter.wasm`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(action): composite GitHub Action with sticky comment, summary, annotations and SARIF upload"
```

---

### Task 14: README, CI, dogfood, publish repo, live Action check

**Files:**
- Create: `README.md`, `LICENSE`, `.github/workflows/ci.yml`, `.github/workflows/review-radar.yml`, `.reviewradar.yml`, `docs/signals.md`
- Modify: `packages/cli/package.json` (copy README/LICENSE on prepack)

**Interfaces:**
- Consumes: the built CLI (`packages/cli/dist/cli.mjs`) and Action (`dist/index.mjs`, `action.yml`).
- Produces: public repo `44dummies/review-radar`, a green CI run, and the Action running on a real PR.

- [ ] **Step 1: LICENSE and example config**

`LICENSE`: the standard MIT text with `Copyright (c) 2026 44dummies`.

`.reviewradar.yml`:
```yaml
# Review Radar config for this repo (dogfood). All keys optional.
sensitivePaths:
  - "packages/core/src/scorer"   # weight changes must be reviewed
ignore:
  - "dist/**"
  - "packages/core/grammars/**"
```

- [ ] **Step 2: CI and dogfood workflows**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
        node: [20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: ${{ matrix.node }}, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npx vitest run --coverage
      - run: npm run build
      - name: dist is up to date
        if: matrix.os == 'ubuntu-latest' && matrix.node == 20
        run: git diff --exit-code -- dist
```

`.github/workflows/review-radar.yml`:
```yaml
name: review-radar
on: pull_request
permissions:
  contents: read
  pull-requests: write
  security-events: write
jobs:
  radar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: ./
```

- [ ] **Step 3: README**

`README.md`, with this structure (fill in the real screenshots in Step 6):
```markdown
# 📡 Review Radar

**Which lines of this AI-written PR do I actually need to read?**

Review Radar scores every hunk of a pull request from 0–100, sorts it into **P0 must-read / P1 should-read / P2 skim**, and tells you *why* in plain sentences. It's deterministic, runs offline, needs no API key and no LLM.

![terminal](docs/img/terminal.png)

## Install

### GitHub Action (5 lines)
​```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: 44dummies/review-radar@v1
​```
Needs `pull-requests: write` (comment) and `security-events: write` (code scanning upload).

### CLI
​```bash
npx review-radar            # current branch vs main
npx review-radar main..HEAD --format md
​```

![pr comment](docs/img/pr-comment.png)

## What it looks at

| Signal | Example evidence |
|---|---|
| sensitive-path | path `src/auth/session.ts` matches sensitive pattern `auth` |
| blast-radius | 14 files import `src/core.ts` |
| untested-change | 32 changed lines in `pay.ts`; no test file imports it |
| test-gaming | skips a test (`.skip`/`xit`/`pytest.mark.skip`) |
| dependency-change | bumps `react` 18 → 19 (major) |
| churn | file changed 7 times in the last 90 days |
| size / diffusion | hunk changes 64 lines · PR touches 23 files |
| external-sarif | Semgrep js.sqli: SQL injection |

Full list and weights: [docs/signals.md](docs/signals.md).

## Bring your scanners
​```yaml
- uses: 44dummies/review-radar@v1
  with:
    sarif: semgrep.sarif,noskip.sarif
​```
Any SARIF 2.1.0 file (Semgrep, CodeQL, noskip, open-code-review) is merged in. Findings that land inside a changed hunk raise its score.

## Why not just an AI reviewer?
AI reviewers add more text to read. Review Radar removes reading: it tells you which hunks are safe to skim, with reproducible evidence you can check. Use both: point your AI reviewer at the P0s.

## Configure
`.reviewradar.yml`: override weights, tiers, sensitive patterns and ignore globs. See [docs/signals.md](docs/signals.md).

## License
MIT
```
(The `​` before each nested code fence is a zero-width space so this plan renders. Leave it out of the real README.)

`docs/signals.md`: one section per signal with what it detects, its default weight (copied from `DEFAULT_CONFIG`), and how to tune it in `.reviewradar.yml`.

- [ ] **Step 4: Full verification**

Run:
```bash
npm run typecheck
npx vitest run --coverage
npm run build
node packages/cli/dist/cli.mjs --version
```
Expected: typecheck clean, all tests pass, `packages/core` line coverage ≥ 80%, build succeeds, version `1.0.0`.

- [ ] **Step 5: Create the public repo and push**

```bash
git add -A
git commit -m "docs: README, signal docs, CI and dogfood workflows"
gh repo create 44dummies/review-radar --public --source . --remote origin --description "Which lines of this AI-written PR do I actually need to read? Deterministic PR risk heatmap: CLI + GitHub Action." --push
gh repo edit 44dummies/review-radar --add-topic code-review --add-topic ai --add-topic github-actions --add-topic sarif --add-topic pull-requests --add-topic developer-tools --add-topic llm --add-topic ai-agents
```
Expected: the repo URL is printed. Then check CI: `gh run watch --exit-status`.

- [ ] **Step 6: Live Action check and screenshots**

```bash
git checkout -b demo/risky-change
# make a deliberately risky change: skip a test and touch the scorer
sed -i "s/it('sums, caps/it.skip('sums, caps/" packages/core/test/scorer.test.ts
git commit -am "demo: risky change for Review Radar"
git push -u origin demo/risky-change
gh pr create --title "demo: risky change" --body "Exercises Review Radar on itself."
gh run watch --exit-status
gh pr view --comments
```
Expected: one Review Radar comment with the scorer test hunk as P0 (test-gaming) and the job summary present. Push a second empty commit (`git commit --allow-empty -m again && git push`) and confirm the comment is **edited**, not duplicated (`gh pr view --comments` still shows one). Take the terminal screenshot (`node packages/cli/dist/cli.mjs main..demo/risky-change`) and the PR-comment screenshot into `docs/img/`. Close the PR without merging and delete the branch.

- [ ] **Step 7: Tag v1 and (with user approval) publish to npm**

```bash
git checkout main
git add docs/img && git commit -m "docs: add screenshots"
git tag v1.0.0 && git tag -f v1 && git push origin main --tags
```
Ask the user before `npm publish`: it's outward-facing and needs their npm login. When approved:
```bash
cp README.md LICENSE packages/cli/
cd packages/cli && npm publish --access public
```
Then `npx review-radar@1.0.0 --version` → `1.0.0`.

---

## Self-review notes

- **Spec coverage:** §2 inputs → Tasks 2, 9, 8 (lcov). §3.3 signals → Tasks 6–9. §3.4 context → Tasks 4–5. §3.5 scorer → Task 10. §3.6 reporters → Task 11. §4 CLI → Task 12. §5 Action (steps 1–6) → Task 13. §6 error handling → Tasks 2 (base missing), 4 (shallow), 5 (unparseable → `[]`), 9 (SARIF error), 13 (comment permission fallback). §7 testing → each task; coverage threshold in `vitest.config.ts`; Action live check in Task 14. §8 launch steps 1–2 → Task 14; HN/listings/cross-link PRs are post-release launch work, not code.
- **Deviations from spec (deliberate, minor):** `Signal.run(ctx)` takes one argument (the change set lives in ctx); Evidence gains `hunkId`; test-gaming uses diff-line regexes instead of AST; the grammar source is the official grammar packages (vendored) instead of `tree-sitter-wasms`, which fails to load in web-tree-sitter 0.27.
- **Type consistency:** `Context`, `Evidence`, `HunkRisk`, `RiskMap` names checked across Tasks 6–13; `fakeCtx`/`diffOf` defined in Task 6 and reused in 7–9; `COMMENT_MARKER` defined in Task 11 and used in Task 13.
