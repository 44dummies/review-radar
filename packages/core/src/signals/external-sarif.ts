import type { Evidence, Signal } from '../types';

export const externalSarifSignal: Signal = {
  name: 'external-sarif',
  run(ctx) {
    const w = ctx.config.weights;
    const weightOf = { error: w.sarifError, warning: w.sarifWarning, note: w.sarifNote, none: w.sarifNote };
    const out: Evidence[] = [];
    for (const r of ctx.sarif) {
      const file = ctx.changeSet.files.find((f) => f.path === r.file);
      if (!file) continue;
      const hunk = file.hunks.find((h) => r.startLine <= h.newRange.end && r.endLine >= h.newRange.start);
      if (!hunk) continue;
      out.push({
        signal: 'external-sarif', hunkId: hunk.id, weight: weightOf[r.level], ruleId: r.ruleId,
        message: `${r.tool} ${r.ruleId}: ${r.message}`, lines: { start: r.startLine, end: r.endLine },
      });
    }
    return out;
  },
};
