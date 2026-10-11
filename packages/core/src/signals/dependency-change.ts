import { posix } from 'node:path';
import type { Evidence, Signal } from '../types';

const MANIFESTS = new Set(['package.json', 'pyproject.toml', 'Pipfile', 'go.mod', 'Cargo.toml', 'composer.json', 'Gemfile']);
const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'poetry.lock', 'uv.lock',
  'Pipfile.lock', 'Cargo.lock', 'go.sum', 'composer.lock', 'Gemfile.lock']);
const REQS = /^requirements[^/]*\.txt$/;

// "name": "^1.2.3"  |  name==1.2  |  name>=1.2  |  name = "1.2"
const JSON_DEP = /^\s*"(@?[\w./-]+)"\s*:\s*"([~^]?\d[^"]*)"/;
const META_KEYS = new Set(['version', 'node', 'npm', 'pnpm', 'yarn']);
const PY_DEP = /^\s*([A-Za-z0-9_.\-[\]]+)\s*(==|>=|~=|<=|>|<|=)\s*"?([\d][^"\s,;]*)/;

function major(v: string): number | undefined {
  const m = /(\d+)/.exec(v);
  return m ? Number(m[1]) : undefined;
}

function parseDeps(lines: string[], file: string): Map<string, string> {
  const re = file === 'package.json' || file === 'composer.json' ? JSON_DEP : PY_DEP;
  const out = new Map<string, string>();
  for (const l of lines) {
    const m = re.exec(l);
    if (!m) continue;
    if (re === JSON_DEP && META_KEYS.has(m[1]!)) continue; // package metadata, not a dependency
    if (re === JSON_DEP) out.set(m[1]!, m[2]!);
    else out.set(m[1]!, `${m[2]}${m[3]}`);
  }
  return out;
}

export const dependencyChangeSignal: Signal = {
  name: 'dependency-change',
  run(ctx) {
    const w = ctx.config.weights;
    const out: Evidence[] = [];
    for (const f of ctx.changeSet.files) {
      const base = posix.basename(f.path);
      if (LOCKFILES.has(base)) {
        const n = f.hunks.reduce((s, h) => s + h.added.length + h.removed.length, 0);
        const first = f.hunks[0];
        if (first) out.push({ signal: 'dependency-change', hunkId: first.id, weight: w.dependencyLockfile, message: `lockfile changed (${n} lines)` });
        continue;
      }
      if (!MANIFESTS.has(base) && !REQS.test(base)) continue;
      for (const h of f.hunks) {
        const added = parseDeps(h.added, base);
        const removed = parseDeps(h.removed, base);
        for (const [name, ver] of added) {
          const prev = removed.get(name);
          if (prev === undefined) {
            const label = base === 'package.json' || base === 'composer.json' ? `${name}@${ver}` : `${name}${ver}`;
            out.push({ signal: 'dependency-change', hunkId: h.id, weight: w.dependencyManifest, message: `adds dependency \`${label}\`` });
            continue;
          }
          const a = major(prev), b = major(ver);
          if (a !== undefined && b !== undefined && b !== a) {
            out.push({
              signal: 'dependency-change', hunkId: h.id, weight: w.dependencyManifest + w.dependencyMajor,
              message: `bumps \`${name}\` ${a} → ${b} (major)`,
            });
          }
        }
      }
    }
    return out;
  },
};
