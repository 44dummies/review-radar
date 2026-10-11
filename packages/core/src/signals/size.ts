import type { Evidence, Signal } from '../types';

export const sizeSignal: Signal = {
  name: 'size',
  run(ctx) {
    const w = ctx.config.weights;
    const out: Evidence[] = [];
    for (const f of ctx.changeSet.files) {
      for (const h of f.hunks) {
        const n = h.added.length + h.removed.length;
        if (n < w.sizeMin) continue;
        out.push({
          signal: 'size', hunkId: h.id,
          weight: Math.min(w.sizeMax, Math.floor(n / 10) * w.sizePer10Lines),
          message: `hunk changes ${n} lines`,
        });
      }
    }
    return out;
  },
};
