import type { RiskMap, Tier } from '../types';

const RANK: Record<Tier, number> = { P0: 0, P1: 1, P2: 2 };

/** A "Where to look" section for a PR description: hunks at or above minTier, with their reasons. */
export function renderPrGuide(map: RiskMap, minTier: Tier = 'P1'): string {
  const head = '## Where to look\n';
  const picked = map.hunks.filter((h) => RANK[h.tier] <= RANK[minTier]);
  if (picked.length === 0) return `${head}_Review Radar v${map.meta.version} found nothing at ${minTier} or above: skim freely._\n`;
  const { p0, p1, p2 } = map.summary;
  const items = picked.map((h) => {
    const { start, end } = h.hunk.newRange;
    const loc = start === end ? `${start}` : `${start}-${end}`;
    return `- **${h.tier} ${h.score}** \`${h.hunk.file}:${loc}\` — ${h.evidence.map((e) => e.message).join('; ')}`;
  });
  return `${head}_Ranked by Review Radar v${map.meta.version} (deterministic, no LLM). ${p0} P0 · ${p1} P1 · ${p2} P2._\n\n${items.join('\n')}\n`;
}
