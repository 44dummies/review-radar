import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { analyze, renderPrGuide, renderTerminal, tryGit, RadarError, VERSION, type RiskMap, type Tier } from '@review-radar/core';

const TIERS = ['P0', 'P1', 'P2'] as const;
const RANK: Record<Tier, number> = { P0: 0, P1: 1, P2: 2 };

const inputSchema = z.object({
  range: z.string().optional().describe('Git range such as main...HEAD. Omit to review this branch plus uncommitted and untracked changes against the default branch.'),
  minTier: z.enum(TIERS).optional().describe('Lowest tier to include: P0 (must read), P1 (should read, default) or P2 (skim).'),
  path: z.string().optional().describe('Path inside the repository. Defaults to the directory the server was started in.'),
});

const outputSchema = z.object({
  summary: z.object({ hunks: z.number(), p0: z.number(), p1: z.number(), p2: z.number(), estMinutes: z.number() }),
  aiAuthored: z.object({ likely: z.boolean(), reasons: z.array(z.string()) }),
  warnings: z.array(z.string()),
  hunks: z.array(z.object({
    tier: z.enum(TIERS), score: z.number(), file: z.string(), startLine: z.number(), endLine: z.number(),
    evidence: z.array(z.object({ signal: z.string(), message: z.string(), weight: z.number() })),
  })),
});
export type ReviewPayload = z.infer<typeof outputSchema>;

export function toPayload(map: RiskMap, minTier: Tier): ReviewPayload {
  const { hunks, p0, p1, p2, estMinutes } = map.summary;
  return {
    summary: { hunks, p0, p1, p2, estMinutes },
    aiAuthored: map.meta.aiAuthored,
    warnings: map.meta.warnings,
    hunks: map.hunks
      .filter((h) => RANK[h.tier] <= RANK[minTier])
      .map((h) => ({
        tier: h.tier, score: h.score, file: h.hunk.file, startLine: h.hunk.newRange.start, endLine: h.hunk.newRange.end,
        evidence: h.evidence.map((e) => ({ signal: e.signal, message: e.message, weight: e.weight })),
      })),
  };
}

/** Repo top level, so a server started in a subdirectory still gets repo-relative paths. */
function repoRoot(cwd: string, path?: string): string {
  const dir = path ? resolve(cwd, path) : cwd;
  const top = tryGit(dir, ['rev-parse', '--show-toplevel'])?.trim();
  if (!top) throw new RadarError('NOT_A_REPO', `${dir} is not inside a git repository.`);
  return top;
}

function review(cwd: string, args: { range?: string; path?: string }): Promise<RiskMap> {
  return analyze({ repoRoot: repoRoot(cwd, args.path), range: args.range, workingTree: !args.range });
}

export function createMcpServer(cwd: string): McpServer {
  const server = new McpServer({ name: 'review-radar', version: VERSION });
  server.registerTool(
    'review_changes',
    {
      title: 'Review Radar: where will a reviewer look?',
      description:
        'Ranks every changed hunk by how much a human reviewer needs to read it (P0 must read, P1 should read, P2 skim), ' +
        'with the evidence behind each score: test gaming (skipped or weakened tests), sensitive code, blast radius, ' +
        'untested changes, dependency bumps. Deterministic, no LLM. Use before opening a PR or after finishing a task.',
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const map = await review(cwd, args);
      return {
        content: [{ type: 'text', text: renderTerminal(map, { color: false }) }],
        structuredContent: toPayload(map, args.minTier ?? 'P1'),
      };
    },
  );
  server.registerTool(
    'pr_review_guide',
    {
      title: 'Review Radar: PR "Where to look" section',
      description: 'Returns a markdown "Where to look" section listing the riskiest hunks and why, ready to paste into a pull request description.',
      inputSchema,
    },
    async (args) => {
      const map = await review(cwd, args);
      return { content: [{ type: 'text', text: renderPrGuide(map, args.minTier ?? 'P1') }] };
    },
  );
  return server;
}

/** Serves the tools over stdio. stdout carries JSON-RPC only. */
export function startStdio(cwd: string) {
  return serveStdio(() => createMcpServer(cwd));
}
