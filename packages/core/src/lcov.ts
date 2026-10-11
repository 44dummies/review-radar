import type { LcovData } from './types';

export function parseLcov(text: string, repoRoot: string): LcovData {
  const root = repoRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const files = new Map<string, Map<number, number>>();
  let current: Map<number, number> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('SF:')) {
      let p = raw.slice(3).replace(/\\/g, '/');
      if (p.toLowerCase().startsWith(root.toLowerCase() + '/')) p = p.slice(root.length + 1);
      p = p.replace(/^\.\//, '');
      current = new Map();
      files.set(p, current);
    } else if (raw.startsWith('DA:') && current) {
      const [line, hits] = raw.slice(3).split(',');
      current.set(Number(line), Number(hits));
    } else if (raw === 'end_of_record') {
      current = undefined;
    }
  }
  return { lines: (p) => files.get(p) };
}
