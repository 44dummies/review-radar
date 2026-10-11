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
