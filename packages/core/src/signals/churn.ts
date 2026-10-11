import type { Evidence, Signal } from '../types';

export const churnSignal: Signal = {
  name: 'churn',
  run(ctx) {
    if (ctx.git.shallow) return [];
    const w = ctx.config.weights;
    const out: Evidence[] = [];
    for (const f of ctx.changeSet.files) {
      const n = ctx.git.churn(f.path);
      if (n < w.churnMin) continue;
      const weight = Math.min(w.churnMax, n * w.churnPerChange);
      for (const h of f.hunks) {
        out.push({ signal: 'churn', hunkId: h.id, weight, message: `file changed ${n} times in the last ${ctx.config.churnDays} days` });
      }
    }
    return out;
  },
};
