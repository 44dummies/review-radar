import { execFileSync } from 'node:child_process';
import { RadarError } from './errors';

export function git(repoRoot: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr ?? String(e);
    throw new RadarError('GIT_FAILED', `git ${args.join(' ')} failed: ${stderr.trim()}`);
  }
}

export function tryGit(repoRoot: string, args: string[]): string | undefined {
  try { return git(repoRoot, args); } catch { return undefined; }
}
