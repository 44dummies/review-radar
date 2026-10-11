import { describe, it, expect } from 'vitest';
import { languageOf, isTestFile } from '../src/lang';

describe('languageOf', () => {
  it.each([
    ['a.ts', 'ts'], ['a.mts', 'ts'], ['a.cts', 'ts'], ['a.tsx', 'tsx'],
    ['a.js', 'js'], ['a.jsx', 'js'], ['a.mjs', 'js'], ['a.cjs', 'js'],
    ['a.py', 'py'], ['a.go', undefined], ['Makefile', undefined],
  ])('%s -> %s', (p, lang) => expect(languageOf(p)).toBe(lang));
});

describe('isTestFile', () => {
  it.each([
    ['src/a.test.ts', true], ['src/a.spec.jsx', true], ['__tests__/a.js', true],
    ['tests/test_api.py', true], ['pkg/api_test.py', true], ['test/helpers/x.ts', true],
    ['src/testing.ts', false], ['src/contest.py', false], ['src/a.ts', false],
  ])('%s -> %s', (p, v) => expect(isTestFile(p)).toBe(v));
});
