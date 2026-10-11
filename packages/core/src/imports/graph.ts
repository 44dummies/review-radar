import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { ImportGraph } from '../types';
import { git } from '../git';
import { languageOf } from '../lang';
import { extractSpecifiers } from './parser';
import { resolveSpecifier } from './resolve';

type Edges = Record<string, string[]>; // file -> files it imports

function fromEdges(edges: Edges): ImportGraph {
  const reverse = new Map<string, string[]>();
  for (const [from, tos] of Object.entries(edges)) {
    for (const to of tos) {
      const list = reverse.get(to) ?? [];
      list.push(from);
      reverse.set(to, list);
    }
  }
  return { importsOf: (p) => edges[p] ?? [], importedBy: (p) => reverse.get(p) ?? [] };
}

export async function buildImportGraph(
  repoRoot: string,
  head: string,
  opts: { useCache?: boolean; maxFiles?: number } = {},
): Promise<ImportGraph> {
  const useCache = opts.useCache ?? true;
  // inside the git dir, so the cache never shows up as a change (or in `git status`)
  const gitPath = git(repoRoot, ['rev-parse', '--git-path', 'review-radar']).trim();
  const cacheDir = isAbsolute(gitPath) ? gitPath : join(repoRoot, gitPath);
  const cacheFile = join(cacheDir, `graph-${head}.json`);
  if (useCache && existsSync(cacheFile)) {
    return fromEdges(JSON.parse(readFileSync(cacheFile, 'utf8')) as Edges);
  }
  const tracked = git(repoRoot, ['ls-files', '-z']).split('\0').filter(Boolean);
  const all = new Set(tracked);
  const sources = tracked.filter((f) => languageOf(f)).slice(0, opts.maxFiles ?? 5000);
  const edges: Edges = {};
  for (const file of sources) {
    const lang = languageOf(file)!;
    let text: string;
    try { text = readFileSync(join(repoRoot, file), 'utf8'); } catch { continue; }
    if (text.length > 1_000_000) continue; // skip generated giants
    const specs = await extractSpecifiers(lang, text);
    const resolved = new Set<string>();
    for (const s of specs) {
      const r = resolveSpecifier(file, s, lang, (p) => all.has(p));
      if (r && r !== file) resolved.add(r);
    }
    if (resolved.size) edges[file] = [...resolved];
  }
  if (useCache) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(edges));
  }
  return fromEdges(edges);
}
