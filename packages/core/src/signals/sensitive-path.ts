import type { Evidence, Signal } from '../types';

/** Regex source -> readable text: drops \b, unescapes \( \. etc. */
const displayPattern = (src: string) => src.replace(/\\b/g, '').replace(/\\(.)/g, '$1');

export const sensitivePathSignal: Signal = {
  name: 'sensitive-path',
  run(ctx) {
    const w = ctx.config.weights;
    const pathRes = ctx.config.sensitivePaths.map((s) => ({ s, re: new RegExp(s, 'i') }));
    const codeRes = ctx.config.sensitiveCode.map((s) => ({ s, re: new RegExp(s, 'i') }));
    const out: Evidence[] = [];
    for (const f of ctx.changeSet.files) {
      const pathHit = pathRes.find(({ re }) => re.test(f.path));
      for (const h of f.hunks) {
        if (pathHit) {
          out.push({ signal: 'sensitive-path', hunkId: h.id, weight: w.sensitivePath,
            message: `path \`${f.path}\` matches sensitive pattern \`${pathHit.s}\`` });
        }
        const codeHit = codeRes.find(({ re }) => h.added.some((l) => re.test(l)));
        if (codeHit) {
          out.push({ signal: 'sensitive-path', hunkId: h.id, weight: w.sensitiveCode, ruleId: 'sensitive-code',
            message: `adds code matching \`${displayPattern(codeHit.s)}\`` });
        }
      }
    }
    return out;
  },
};
