import { posix } from 'node:path';
import type { Signal } from '../types';

export const diffusionSignal: Signal = {
  name: 'diffusion',
  run(ctx) {
    const files = ctx.changeSet.files;
    const dirs = new Set(files.map((f) => posix.dirname(f.path)));
    const { files: maxFiles, dirs: maxDirs } = ctx.config.diffusion;
    if (files.length < maxFiles && dirs.size < maxDirs) return [];
    return [{
      signal: 'diffusion', hunkId: '*', weight: ctx.config.weights.diffusion,
      message: `PR touches ${files.length} files across ${dirs.size} directories`,
    }];
  },
};
