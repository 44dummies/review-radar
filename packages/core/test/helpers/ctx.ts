import type { Context } from '../../src/types';
import { parseUnifiedDiff } from '../../src/diff';
import { DEFAULT_CONFIG } from '../../src/config';

/** Build a diff string from {path: [removedLines, addedLines]} for compact tests. */
export function diffOf(files: Record<string, { add?: string[]; del?: string[]; start?: number; status?: 'added' | 'deleted' }>): string {
  const out: string[] = [];
  for (const [p, f] of Object.entries(files)) {
    const add = f.add ?? [], del = f.del ?? [], s = f.start ?? 1;
    out.push(`diff --git a/${p} b/${p}`);
    if (f.status === 'added') out.push('new file mode 100644');
    if (f.status === 'deleted') out.push('deleted file mode 100644');
    out.push(`--- ${f.status === 'added' ? '/dev/null' : `a/${p}`}`, `+++ ${f.status === 'deleted' ? '/dev/null' : `b/${p}`}`);
    out.push(`@@ -${s},${del.length} +${f.status === 'deleted' ? 0 : s},${add.length} @@`);
    out.push(...del.map((l) => `-${l}`), ...add.map((l) => `+${l}`));
  }
  return out.join('\n') + '\n';
}

export function fakeCtx(diff: string, over: Partial<Context> = {}): Context {
  return {
    repoRoot: '/repo',
    changeSet: { base: 'b', head: 'h', files: parseUnifiedDiff(diff) },
    importGraph: { importedBy: () => [], importsOf: () => [] },
    git: { churn: () => 0, shallow: false },
    sarif: [],
    config: structuredClone(DEFAULT_CONFIG),
    readFile: () => undefined,
    testFiles: [],
    ...over,
  };
}
