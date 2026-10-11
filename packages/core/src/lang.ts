import type { Lang } from './types';

const EXT: Record<string, Lang> = {
  ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', py: 'py',
};

export function languageOf(path: string): Lang | undefined {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? EXT[m[1]!.toLowerCase()] : undefined;
}

const TEST_PATTERNS = [
  /(^|\/)(__tests__|tests?)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.py$/,
];

export function isTestFile(path: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(path));
}
