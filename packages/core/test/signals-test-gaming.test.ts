import { describe, it, expect } from 'vitest';
import { testGamingSignal } from '../src/signals/test-gaming';
import { diffOf, fakeCtx } from './helpers/ctx';

const rules = (diff: string) => (testGamingSignal.run(fakeCtx(diff)) as any[]).map((e) => e.ruleId);

describe('test-gaming', () => {
  it('flags deleted test files', () => {
    expect(rules(diffOf({ 'src/a.test.ts': { status: 'deleted', del: ["it('x', () => {})"] } }))).toEqual(['test-file-deleted']);
  });
  it.each([
    ["  it.skip('works', () => {", 'skip-added'],
    ["  xit('works', () => {", 'skip-added'],
    ["  describe.skip('suite', () => {", 'skip-added'],
    ['@pytest.mark.skip(reason="flaky")', 'skip-added'],
    ['@pytest.mark.xfail', 'skip-added'],
    ["  it.only('works', () => {", 'only-added'],
    ["  fdescribe('suite', () => {", 'only-added'],
  ])('flags %s', (line, rule) => {
    expect(rules(diffOf({ 'test/a.test.ts': { add: [line] } }))).toEqual([rule]);
  });
  it('flags net assertion removal', () => {
    expect(rules(diffOf({ 'tests/test_api.py': { del: ['    assert r.status == 200', '    assert r.json() == {}'], add: ['    pass'] } })))
      .toEqual(['assertions-removed']);
  });
  it('flags weakened matchers', () => {
    expect(rules(diffOf({ 'a.spec.ts': { del: ['  expect(total).toBe(42);'], add: ['  expect(total).toBeDefined();'] } })))
      .toEqual(['matcher-weakened']);
  });
  it('ignores the same patterns in non-test files', () => {
    expect(rules(diffOf({ 'src/a.ts': { add: ["it.skip('x')"] } }))).toEqual([]);
  });
  it('does not flag rewritten assertions with equal counts', () => {
    expect(rules(diffOf({ 'a.test.ts': { del: ['expect(a).toBe(1);'], add: ['expect(a).toBe(2);'] } }))).toEqual([]);
  });
  it('uses the testGaming weight and a readable message', () => {
    const [e] = testGamingSignal.run(fakeCtx(diffOf({ 'a.test.ts': { add: ["it.only('x', () => {})"] } }))) as any[];
    expect(e.weight).toBe(70);
    expect(e.message).toBe('focuses a single test with `.only`/`fit` (other tests stop running)');
  });
});
