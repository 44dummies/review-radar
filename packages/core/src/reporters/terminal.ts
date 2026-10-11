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
