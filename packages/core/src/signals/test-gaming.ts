import type { Evidence, Signal } from '../types';

const SKIP = /\b(it|test|describe)\.skip\s*\(|\bx(it|describe|test)\s*\(|@pytest\.mark\.(skip|xfail)|\bpytest\.skip\s*\(|@unittest\.skip/;
const ONLY = /\b(it|test|describe)\.only\s*\(|\bf(it|describe)\s*\(/;
const ASSERT = /\bexpect\s*\(|\bassert\b|\bself\.assert\w+\s*\(|\bassert\w*\s*\(/;
const STRICT = /\.(toBe|toEqual|toStrictEqual|toHaveBeenCalledWith|toMatchObject)\s*\(\s*[^)\s]|\.toThrow\s*\(\s*[^)\s]|assert\s+[^=\n]+==/;
const WEAK = /\.(toBeDefined|toBeTruthy|toBeFalsy)\s*\(\s*\)|\.not\.toBeNull\s*\(\s*\)|\.toThrow\s*\(\s*\)|\.toHaveBeenCalled\s*\(\s*\)|^\s*assert\s+\w+\s*$/;

const MSG = {
  'test-file-deleted': (p: string) => `deletes test file \`${p}\``,
  'skip-added': () => 'skips a test (`.skip`/`xit`/`pytest.mark.skip`/`xfail`)',
  'only-added': () => 'focuses a single test with `.only`/`fit` (other tests stop running)',
  'assertions-removed': (n: string) => `removes ${n} more assertion(s) than it adds`,
  'matcher-weakened': () => 'replaces a strict assertion with a weaker one (e.g. `toBe(x)` → `toBeDefined()`)',
};

export const testGamingSignal: Signal = {
  name: 'test-gaming',
  run(ctx) {
    const weight = ctx.config.weights.testGaming;
    const out: Evidence[] = [];
    const push = (hunkId: string, ruleId: keyof typeof MSG, arg = '') =>
      out.push({ signal: 'test-gaming', hunkId, weight, ruleId, message: MSG[ruleId](arg) });

    for (const f of ctx.changeSet.files) {
      if (!f.isTest) continue;
      if (f.status === 'deleted') {
        const h = f.hunks[0];
        if (h) push(h.id, 'test-file-deleted', f.path);
        continue;
      }
      for (const h of f.hunks) {
        if (h.added.some((l) => SKIP.test(l))) push(h.id, 'skip-added');
        if (h.added.some((l) => ONLY.test(l))) push(h.id, 'only-added');
        const removedAsserts = h.removed.filter((l) => ASSERT.test(l)).length;
        const addedAsserts = h.added.filter((l) => ASSERT.test(l)).length;
        if (removedAsserts > addedAsserts) push(h.id, 'assertions-removed', String(removedAsserts - addedAsserts));
        else if (h.removed.some((l) => STRICT.test(l)) && h.added.some((l) => WEAK.test(l))) push(h.id, 'matcher-weakened');
      }
    }
    return out;
  },
};
