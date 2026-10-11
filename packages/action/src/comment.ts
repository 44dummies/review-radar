import { COMMENT_MARKER, type RiskMap } from '@review-radar/core';

export interface Target { owner: string; repo: string; issue_number: number }
export interface CommentApi {
  list(t: Target): Promise<{ id: number; body?: string | null }[]>;
  create(t: Target, body: string): Promise<void>;
  update(t: Target, id: number, body: string): Promise<void>;
}

export async function upsertComment(api: CommentApi, t: Target, body: string): Promise<'created' | 'updated'> {
  const existing = (await api.list(t)).find((c) => c.body?.includes(COMMENT_MARKER));
  if (existing) { await api.update(t, existing.id, body); return 'updated'; }
  await api.create(t, body);
  return 'created';
}

export function topAnnotations(map: RiskMap, max = 10) {
  return map.hunks
    .filter((r) => r.tier === 'P0')
    .slice(0, max)
    .map((r) => ({
      file: r.hunk.file,
      startLine: Math.max(1, r.hunk.newRange.start),
      endLine: Math.max(1, r.hunk.newRange.end),
      title: `Review Radar ${r.tier} (${r.score})`,
      message: r.evidence.map((e) => e.message).join('\n'),
    }));
}
