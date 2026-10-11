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
  it.each([
    ['assert.equal(total(items), 7);', 'assert.ok(total(items));'],
    ['assert.deepStrictEqual(r, { a: 1 });', 'assert(r);'],
    ['assert.strict.equal(r.status, 200);', 'assert.ok(r.status, "has a status");'],
    ['expect(r).to.equal(42);', 'expect(r).to.exist;'],
    ['expect(r).to.deep.equal({ a: 1 });', 'expect(r).to.be.ok;'],
    ["expect(fn).to.throw(TypeError);", 'expect(fn).to.throw();'],
    ['r.should.equal(42);', 'r.should.exist;'],
    ['expect(user.id).to.equal(7);', 'expect(user).to.not.be.undefined;'],
  ])('flags weakened node:assert / chai assertions: %s → %s', (from, to) => {
    expect(rules(diffOf({ 'test/a.test.js': { del: [`  ${from}`], add: [`  ${to}`] } }))).toEqual(['matcher-weakened']);
  });
  it.each([
    ['assert.equal(a, 1);', 'assert.equal(a, 2);'],
    ['assert.ok(a);', 'assert.ok(b);'],
    ['expect(r).to.equal(1);', 'expect(r).to.equal(2);'],
    ['expect(r).to.exist;', 'expect(r).to.equal(3);'],
    ['assert r.status == 200', 'assert (r.status == 201)'],
    ['assert.equal(a, 1);', 'assert(a === 1);'],
  ])('does not flag rewritten node:assert / chai assertions: %s → %s', (from, to) => {
    expect(rules(diffOf({ 'test/a.test.js': { del: [`  ${from}`], add: [`  ${to}`] } }))).toEqual([]);
  });
  it('ignores test-gaming patterns that only appear inside string literals', () => {
    expect(rules(diffOf({ 'test/fixtures.test.ts': { add: [
      `  r.write({ 'a.test.ts': "it.skip('a', () => {});\\n" });`,
      "  const src = `describe.only('x', () => {})`;",
      "  check('@pytest.mark.skip on line 3');",
    ] } }))).toEqual([]);
  });
  it('still flags a real skip that has a string argument', () => {
    expect(rules(diffOf({ 'a.test.ts': { add: ["it.skip('handles \"quoted\" names', () => {"] } }))).toEqual(['skip-added']);
  });
  it('does not count assertions written inside strings', () => {
    expect(rules(diffOf({ 'a.test.ts': { del: ['  const s = "expect(a).toBe(1)";'], add: ['  const s = "";'] } }))).toEqual([]);
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
