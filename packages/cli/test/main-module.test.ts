import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainModule } from '../src/cli';

describe('isMainModule', () => {
  it('is true when argv[1] reaches the script through a symlinked directory (npm bin / npx)', () => {
    const root = mkdtempSync(join(tmpdir(), 'rr-main-'));
    const real = join(root, 'real');
    mkdirSync(real);
    const script = join(real, 'cli.mjs');
    writeFileSync(script, '');
    const link = join(root, 'link');
    symlinkSync(real, link, 'junction'); // junction works on Windows without admin; plain dir symlink elsewhere
    expect(isMainModule(pathToFileURL(script).href, join(link, 'cli.mjs'))).toBe(true);
  });
  it('is false for a different script or a missing argv[1]', () => {
    const root = mkdtempSync(join(tmpdir(), 'rr-main-'));
    const a = join(root, 'a.mjs'); const b = join(root, 'b.mjs');
    writeFileSync(a, ''); writeFileSync(b, '');
    expect(isMainModule(pathToFileURL(a).href, b)).toBe(false);
    expect(isMainModule(pathToFileURL(a).href, undefined)).toBe(false);
  });
});
