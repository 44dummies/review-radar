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
