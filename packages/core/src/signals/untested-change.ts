import type { Evidence, Signal } from '../types';
import { declaredSymbols } from '../symbols';
import { isTestFile } from '../lang';

export const untestedChangeSignal: Signal = {
  name: 'untested-change',
  run(ctx) {
    const weight = ctx.config.weights.untestedChange;
    const out: Evidence[] = [];
    const testText = new Map<string, string>();
    const readTest = (p: string) => {
      if (!testText.has(p)) testText.set(p, ctx.readFile(p) ?? '');
      return testText.get(p)!;
    };
    for (const f of ctx.changeSet.files) {
      if (f.isTest || !f.language || f.status === 'deleted') continue;
      for (const h of f.hunks) {
        if (h.addedLines.length === 0) continue;
        const cov = ctx.lcov?.lines(f.path);
        if (cov) {
          const measured = h.addedLines.filter((l) => cov.has(l));
          if (measured.length === 0) continue;
          const covered = measured.filter((l) => (cov.get(l) ?? 0) > 0).length;
          if (covered === 0) {
            out.push({ signal: 'untested-change', hunkId: h.id, weight,
              message: `0 of ${measured.length} changed lines covered (lcov)` });
          }
          continue;
        }
        const importedByTest = ctx.importGraph.importedBy(f.path).some((p) => ctx.testFiles.includes(p) || isTestFile(p));
        if (importedByTest) continue;
        const symbols = declaredSymbols(h.added);
        const mentioned = symbols.some((s) => ctx.testFiles.some((t) => new RegExp(`\\b${s.replace(/\$/g, '\\$')}\\b`).test(readTest(t))));
        if (mentioned) continue;
        const what = symbols.length ? ` or mentions \`${symbols.slice(0, 3).join('`, `')}\`` : '';
        out.push({ signal: 'untested-change', hunkId: h.id, weight,
          message: `${h.addedLines.length} changed lines in \`${f.path}\`; no test file imports it${what}` });
      }
    }
    return out;
  },
};
