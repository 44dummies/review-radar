import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { renderTerminal, renderMarkdown, renderJson, renderSarif, renderPrGuide, COMMENT_MARKER } from '../src/reporters/index';
import type { RiskMap, HunkRisk, Tier } from '../src/types';

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
      // P0 → warning, P1 → note: GitHub code scanning fails the PR check on any 'error',
      // and blocking merges must stay opt-in via --fail-on / fail-on.
      ['test-gaming', 'warning'],  // src/auth.ts: highest-weight evidence
      ['test-gaming', 'note'],     // src/api.ts: the fixture helper labels the first evidence 'test-gaming'
      ['test-gaming', 'warning'],  // old.test.ts
    ]);
    expect(results[0].message.text).toBe('skips a test; hunk changes 45 lines (score 85, P0)');
    const del = results.find((r: any) => r.locations[0].physicalLocation.artifactLocation.uri === 'old.test.ts');
    expect(del.locations[0].physicalLocation.region.startLine).toBe(1);
    expect(doc.runs[0].tool.driver.name).toBe('review-radar');
  });
});

describe('renderPrGuide', () => {
  const risk = (file: string, start: number, end: number, tier: Tier, score: number, msgs: string[]): HunkRisk => ({
    hunk: { id: `${file}:${start}-${end}`, file, oldRange: { start, end }, newRange: { start, end }, added: [], removed: [], addedLines: [] },
    score, tier, evidence: msgs.map((message) => ({ signal: 's', hunkId: `${file}:${start}-${end}`, weight: 1, message })),
  });
  const mapOf = (hunks: HunkRisk[]): RiskMap => ({
    changeSet: { base: 'b', head: 'h', files: [] }, hunks,
    summary: { hunks: hunks.length, p0: hunks.filter((h) => h.tier === 'P0').length, p1: hunks.filter((h) => h.tier === 'P1').length, p2: hunks.filter((h) => h.tier === 'P2').length, estMinutes: 1, skippedFiles: [] },
    meta: { version: '9.9.9', warnings: [], aiAuthored: { likely: false, reasons: [] } },
  });
  const map = mapOf([
    risk('test/checkout.test.ts', 9, 9, 'P0', 100, ['skips a test', 'path matches `checkout`']),
    risk('src/auth/session.ts', 5, 6, 'P0', 82, ['path matches `auth`']),
    risk('package.json', 6, 6, 'P1', 50, ['bumps `stripe` 16 → 17 (major)']),
    risk('src/utils/format.ts', 2, 3, 'P2', 28, ['small']),
  ]);

  it('lists hunks at or above P1 by default, with location and reasons', () => {
    expect(renderPrGuide(map)).toBe(
      '## Where to look\n' +
      '_Ranked by Review Radar v9.9.9 (deterministic, no LLM). 2 P0 · 1 P1 · 1 P2._\n\n' +
      '- **P0 100** `test/checkout.test.ts:9` — skips a test; path matches `checkout`\n' +
      '- **P0 82** `src/auth/session.ts:5-6` — path matches `auth`\n' +
      '- **P1 50** `package.json:6` — bumps `stripe` 16 → 17 (major)\n',
    );
  });
  it('honours minTier', () => {
    expect(renderPrGuide(map, 'P0')).not.toContain('package.json');
    expect(renderPrGuide(map, 'P2')).toContain('`src/utils/format.ts:2-3`');
  });
  it('says so when nothing reaches minTier', () => {
    expect(renderPrGuide(mapOf([risk('a.ts', 1, 1, 'P2', 5, ['x'])]))).toBe(
      '## Where to look\n_Review Radar v9.9.9 found nothing at P1 or above: skim freely._\n',
    );
  });
});
