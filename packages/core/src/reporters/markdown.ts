import type { RiskMap, Tier } from '../types';

export const COMMENT_MARKER = '<!-- review-radar -->';
const ICON: Record<Tier, string> = { P0: '🔴', P1: '🟡', P2: '⚪' };

export function renderMarkdown(map: RiskMap, opts: { marker?: boolean } = {}): string {
  const out: string[] = [];
  if (opts.marker) out.push(COMMENT_MARKER);
  out.push('## 📡 Review Radar');
  if (map.meta.aiAuthored.likely) out.push(`🤖 **Likely AI-authored**: ${map.meta.aiAuthored.reasons.join('; ')}`);
  const s = map.summary;
  out.push('', `**${s.hunks} hunks** · ${s.p0} P0 · ${s.p1} P1 · ${s.p2} P2 · est. review time **${s.estMinutes} min**`);
  if (map.hunks.length === 0) {
    out.push('', 'No reviewable changes.');
  } else {
    const shown = map.hunks.filter((r) => r.tier !== 'P2');
    if (shown.length) {
      out.push('', '| Tier | Score | Where |', '|---|---|---|');
      for (const r of shown) out.push(`| ${ICON[r.tier]} ${r.tier} | ${r.score} | \`${r.hunk.file}:${r.hunk.newRange.start}-${r.hunk.newRange.end}\` |`);
      out.push('');
      for (const r of shown) {
        out.push(`<details><summary><code>${r.hunk.file}:${r.hunk.newRange.start}-${r.hunk.newRange.end}</code>: ${r.tier} (${r.score})</summary>`, '');
        for (const e of r.evidence) out.push(`- ${e.message} (+${e.weight})`);
        out.push('', '</details>');
      }
    }
    if (s.p2) out.push('', `_${s.p2} P2 hunk(s) hidden: low risk, skim only._`);
  }
  for (const w of map.meta.warnings) out.push('', `> ⚠️ ${w}`);
  out.push('', `<sub>review-radar v${map.meta.version} · deterministic, no LLM · <a href="https://github.com/44dummies/review-radar">docs</a></sub>`);
  return out.join('\n') + '\n';
}
