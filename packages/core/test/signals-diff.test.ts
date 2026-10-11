import { describe, it, expect } from 'vitest';
import { sizeSignal } from '../src/signals/size';
import { diffusionSignal } from '../src/signals/diffusion';
import { dependencyChangeSignal } from '../src/signals/dependency-change';
import { sensitivePathSignal } from '../src/signals/sensitive-path';
import { diffOf, fakeCtx } from './helpers/ctx';

const lines = (n: number) => Array.from({ length: n }, (_, i) => `x${i}`);

describe('size', () => {
  it('ignores small hunks and scales big ones up to the cap', () => {
    const ctx = fakeCtx(diffOf({ 'a.ts': { add: lines(10) }, 'b.ts': { add: lines(45) }, 'c.ts': { add: lines(500) } }));
    const ev = sizeSignal.run(ctx) as any[];
    expect(ev.map((e) => [e.hunkId.split(':')[0], e.weight])).toEqual([['b.ts', 8], ['c.ts', 20]]);
    expect(ev[0]!.message).toBe('hunk changes 45 lines');
  });
});

describe('diffusion', () => {
  it('emits one PR-level evidence when many files/dirs are touched', () => {
    const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`d${i % 6}/f${i}.ts`, { add: ['x'] }]));
    const ev = diffusionSignal.run(fakeCtx(diffOf(files))) as any[];
    expect(ev).toEqual([expect.objectContaining({ hunkId: '*', weight: 10, message: 'PR touches 12 files across 6 directories' })]);
  });
  it('is silent for small PRs', () => {
    expect(diffusionSignal.run(fakeCtx(diffOf({ 'a.ts': { add: ['x'] } })))).toEqual([]);
  });
});

describe('dependency-change', () => {
  it('flags new npm deps and major bumps in package.json', () => {
    const ctx = fakeCtx(diffOf({
      'package.json': { del: ['    "react": "^18.2.0",'], add: ['    "react": "^19.0.0",', '    "left-pad": "^1.3.0",'] },
    }));
    const msgs = (dependencyChangeSignal.run(ctx) as any[]).map((e) => [e.message, e.weight]);
    expect(msgs).toContainEqual(['adds dependency `left-pad@^1.3.0`', 30]);
    expect(msgs).toContainEqual(['bumps `react` 18 → 19 (major)', 50]);
  });
  it('flags requirements.txt additions and lockfile-only changes', () => {
    const ctx = fakeCtx(diffOf({ 'requirements.txt': { add: ['requests==2.32.0'] }, 'package-lock.json': { add: lines(30) } }));
    const msgs = (dependencyChangeSignal.run(ctx) as any[]).map((e) => [e.message, e.weight]);
    expect(msgs).toContainEqual(['adds dependency `requests==2.32.0`', 30]);
    expect(msgs).toContainEqual(['lockfile changed (30 lines)', 10]);
  });
  it('ignores non-dependency package.json fields', () => {
    const ctx = fakeCtx(diffOf({ 'package.json': { del: ['  "version": "1.0.0",'], add: ['  "version": "1.1.0",'] } }));
    expect(dependencyChangeSignal.run(ctx)).toEqual([]);
  });
});

describe('sensitive-path', () => {
  it('flags sensitive paths once per hunk', () => {
    const ctx = fakeCtx(diffOf({ 'src/auth/session.ts': { add: ['x'] }, 'src/ui/button.ts': { add: ['x'] } }));
    const ev = sensitivePathSignal.run(ctx) as any[];
    expect(ev).toHaveLength(1);
    expect(ev[0].message).toBe('path `src/auth/session.ts` matches sensitive pattern `auth`');
    expect(ev[0].weight).toBe(45);
  });
  it('flags dangerous code in added lines', () => {
    const ctx = fakeCtx(diffOf({ 'src/run.ts': { add: ["import { exec } from 'child_process';", 'exec(cmd);'] } }));
    const ev = sensitivePathSignal.run(ctx) as any[];
    expect(ev).toEqual([expect.objectContaining({ weight: 35, message: 'adds code matching `child_process`' })]);
  });
  it('is case-insensitive and honours extra config patterns', () => {
    const ctx = fakeCtx(diffOf({ 'src/Ledger.ts': { add: ['x'] } }));
    ctx.config.sensitivePaths.push('ledger');
    expect((sensitivePathSignal.run(ctx) as any[])[0].message).toContain('`ledger`');
  });
});
