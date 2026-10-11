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

  it('three-dot base...head diffs from the merge-base (PR semantics), ignoring later base commits', () => {
    const r = makeRepo();
    r.write({ 'a.ts': '1\n' });
    r.commit('init');
    r.git('checkout', '-q', '-b', 'feature');
    r.write({ 'feat.ts': 'x\n' });
    const head = r.commit('feat');
    r.git('checkout', '-q', 'main');
    r.write({ 'main-only.ts': 'y\n' });
    const base = r.commit('main moves on');
    expect(getChangeSet(r.root, `${base}...${head}`).files.map((f) => f.path)).toEqual(['feat.ts']);
    // two-dot keeps git's direct-diff meaning
    expect(getChangeSet(r.root, `${base}..${head}`).files.map((f) => f.path).sort()).toEqual(['feat.ts', 'main-only.ts']);
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
