import type { RiskMap } from '../types';

const RULE_TEXT: Record<string, string> = {
  'sensitive-path': 'Change touches a sensitive path or dangerous API',
  'blast-radius': 'Changed module is imported by many files',
  'untested-change': 'Changed code has no detectable test coverage',
  'test-gaming': 'Tests were skipped, deleted or weakened',
  'dependency-change': 'Dependencies were added or bumped',
  churn: 'File changes frequently',
  size: 'Large hunk',
  diffusion: 'PR is spread across many files',
  'external-sarif': 'Finding from another scanner',
};

export function renderSarif(map: RiskMap): string {
  const flagged = map.hunks.filter((r) => r.tier !== 'P2');
  const top = (r: (typeof flagged)[number]) => [...r.evidence].sort((a, b) => b.weight - a.weight)[0]?.signal ?? 'size';
  const ruleIds = [...new Set(flagged.map(top))];
  const doc = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: {
        name: 'review-radar', version: map.meta.version, informationUri: 'https://github.com/44dummies/review-radar',
        rules: ruleIds.map((id) => ({ id, shortDescription: { text: RULE_TEXT[id] ?? id } })),
      } },
      results: flagged.map((r) => ({
        ruleId: top(r),
        // never 'error': code scanning fails the PR check on errors; blocking is opt-in via fail-on
        level: r.tier === 'P0' ? 'warning' : 'note',
        message: { text: `${r.evidence.map((e) => e.message).join('; ')} (score ${r.score}, ${r.tier})` },
        locations: [{ physicalLocation: {
          artifactLocation: { uri: r.hunk.file },
          region: { startLine: Math.max(1, r.hunk.newRange.start), endLine: Math.max(1, r.hunk.newRange.end) },
        } }],
      })),
    }],
  };
  return JSON.stringify(doc, null, 2) + '\n';
}
