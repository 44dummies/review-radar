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
