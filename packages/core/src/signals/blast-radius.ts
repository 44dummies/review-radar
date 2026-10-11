import type { Evidence, Signal } from '../types';

export const blastRadiusSignal: Signal = {
  name: 'blast-radius',
  run(ctx) {
    const w = ctx.config.weights;
    const out: Evidence[] = [];
    for (const f of ctx.changeSet.files) {
      if (f.status === 'deleted') continue;
      const importers = ctx.importGraph.importedBy(f.path);
      if (importers.length === 0) continue;
      const weight = Math.min(w.blastRadiusMax, importers.length * w.blastRadiusPerImporter);
      const eg = importers.slice(0, 3).join(', ');
      const message = `${importers.length} file${importers.length === 1 ? '' : 's'} import${importers.length === 1 ? 's' : ''} \`${f.path}\` (e.g. ${eg})`;
      for (const h of f.hunks) out.push({ signal: 'blast-radius', hunkId: h.id, weight, message });
    }
    return out;
  },
};
