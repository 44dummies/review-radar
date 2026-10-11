import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface Repo {
  root: string;
  git(...args: string[]): string;
  write(files: Record<string, string>): void;
  rm(path: string): void;
  commit(msg: string, opts?: { author?: string; email?: string }): string;
}

export function makeRepo(): Repo {
  const root = mkdtempSync(join(tmpdir(), 'rr-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'core.autocrlf', 'false');
  git('config', 'commit.gpgsign', 'false');
  return {
    root,
    git,
    write(files) {
      for (const [p, content] of Object.entries(files)) {
        const abs = join(root, p);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
      }
    },
    rm(p) { rmSync(join(root, p)); },
    commit(msg, opts = {}) {
      git('add', '-A');
      const author = `${opts.author ?? 'Test'} <${opts.email ?? 'test@example.com'}>`;
      git('commit', '-q', '--allow-empty', '-m', msg, `--author=${author}`);
      return git('rev-parse', 'HEAD');
    },
  };
}
