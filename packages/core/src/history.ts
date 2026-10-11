import type { AiAuthorship, GitHistory } from './types';
import { tryGit } from './git';

export function buildGitHistory(repoRoot: string, head: string, days: number): GitHistory {
  const shallow = tryGit(repoRoot, ['rev-parse', '--is-shallow-repository'])?.trim() === 'true';
  const out = tryGit(repoRoot, ['log', `--since=${days}.days`, '--format=%x00', '--name-only', head]) ?? '';
  const counts = new Map<string, number>();
  for (const commit of out.split('\0')) {
    const paths = new Set(commit.split('\n').map((s) => s.trim()).filter(Boolean));
    for (const p of paths) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return { shallow, churn: (p) => counts.get(p) ?? 0 };
}

const AGENT_NAMES = 'Claude|Copilot|Cursor|Codex|Devin|Aider|Gemini|Jules|Windsurf|Cline|OpenHands|Sweep|Amp';
// Whole words only: "Champion" must not match "Amp", "Claude Monet" is a person.
const AGENT_WORD = new RegExp(`\\b(?:${AGENT_NAMES})\\b`, 'i');
const TRAILER_RE = /^Co-Authored-By:\s*(.*)$/gim;
const FOOTER_RE = /Generated with \[?(Claude Code|Cursor|Codex|Aider)/i;
/** A commit author counts only when it is a bot account that names an AI agent (dependabot[bot] is not AI). */
const isAgentBot = (name: string) => /\[bot\]/i.test(name) && AGENT_WORD.test(name);

export function detectAiAuthorship(repoRoot: string, base: string, head: string): AiAuthorship {
  const out = tryGit(repoRoot, ['log', '--format=%an%x1f%ae%x1f%B%x1e', `${base}..${head}`]) ?? '';
  const reasons = new Set<string>();
  for (const rec of out.split('\x1e')) {
    const [name = '', , body = ''] = rec.trim().split('\x1f');
    if (!name) continue;
    if (isAgentBot(name)) reasons.add(`commit author ${name}`);
    for (const t of body.matchAll(TRAILER_RE)) {
      if (AGENT_WORD.test(t[1]!)) reasons.add(`Co-Authored-By: ${t[1]!.trim()}`);
    }
    const f = FOOTER_RE.exec(body);
    if (f) reasons.add(`"Generated with ${f[1]}" footer`);
  }
  return { likely: reasons.size > 0, reasons: [...reasons] };
}
