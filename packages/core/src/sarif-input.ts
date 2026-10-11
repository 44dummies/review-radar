import type { SarifResult } from './types';
import { RadarError } from './errors';

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function stripFileScheme(uri: string): string {
  if (!uri.startsWith('file:')) return uri;
  let p = uri.replace(/^file:\/\//, '');
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // /C:/x -> C:/x
  return p;
}

export function normalizeUri(uri: string, repoRoot: string, baseIds: Record<string, string> = {}, baseId?: string): string {
  let u = uri;
  const base = baseId ? baseIds[baseId] : undefined;
  if (base && !/^(file:|[A-Za-z]:|\/)/.test(u)) u = (base.endsWith('/') ? base : base + '/') + u;
  let p = toPosix(decodeURIComponent(stripFileScheme(u)));
  const root = toPosix(repoRoot).replace(/\/+$/, '');
  if (p.toLowerCase().startsWith(root.toLowerCase() + '/')) p = p.slice(root.length + 1);
  return p.replace(/^\.\//, '');
}

interface RawResult {
  ruleId?: string;
  level?: SarifResult['level'];
  message?: { text?: string };
  locations?: { physicalLocation?: { artifactLocation?: { uri?: string; uriBaseId?: string }; region?: { startLine?: number; endLine?: number } } }[];
}

export function parseSarif(json: string, repoRoot: string): SarifResult[] {
  let doc: { runs?: { tool?: { driver?: { name?: string } }; originalUriBaseIds?: Record<string, { uri?: string }>; results?: RawResult[] }[] };
  try { doc = JSON.parse(json); } catch (e) {
    throw new RadarError('BAD_INPUT', `Invalid SARIF JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(doc.runs)) throw new RadarError('BAD_INPUT', 'SARIF file has no "runs" array.');
  const out: SarifResult[] = [];
  for (const run of doc.runs) {
    const tool = run.tool?.driver?.name ?? 'unknown';
    const baseIds = Object.fromEntries(Object.entries(run.originalUriBaseIds ?? {}).map(([k, v]) => [k, v.uri ?? '']));
    for (const r of run.results ?? []) {
      const loc = r.locations?.[0]?.physicalLocation;
      const uri = loc?.artifactLocation?.uri;
      if (!uri) continue;
      const startLine = loc?.region?.startLine ?? 1;
      out.push({
        tool,
        ruleId: r.ruleId ?? 'unknown',
        level: r.level ?? 'warning',
        message: r.message?.text ?? '',
        file: normalizeUri(uri, repoRoot, baseIds, loc?.artifactLocation?.uriBaseId),
        startLine,
        endLine: loc?.region?.endLine ?? startLine,
      });
    }
  }
  return out;
}
