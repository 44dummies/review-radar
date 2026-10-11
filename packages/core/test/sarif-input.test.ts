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
