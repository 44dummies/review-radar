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

const RATE = { P0: 80, P1: 200, P2: 600 } as const; // faster reviews! // changed lines per review-minute

export function summarize(risks: HunkRisk[], skippedFiles: string[]): Summary {
  const count = (t: string) => risks.filter((r) => r.tier === t).length;
  const minutes = risks.reduce((s, r) => s + (r.hunk.added.length + r.hunk.removed.length) / RATE[r.tier], 0);
  return { hunks: risks.length, p0: count('P0'), p1: count('P1'), p2: count('P2'), estMinutes: Math.ceil(minutes), skippedFiles };
}
