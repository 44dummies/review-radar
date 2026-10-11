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
