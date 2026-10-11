import type { ChangedFile, ChangeSet, Hunk, Range } from './types';
import { languageOf, isTestFile } from './lang';
import { git, tryGit } from './git';
import { RadarError } from './errors';

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function range(start: number, count: number): Range {
  if (count === 0) return { start, end: start };
  return { start, end: start + count - 1 };
}

function stripPrefix(p: string): string {
  return p.replace(/^[ab]\//, '');
}

export function parseUnifiedDiff(text: string): ChangedFile[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const files: ChangedFile[] = [];
  let file: ChangedFile | undefined;
  let hunk: Hunk | undefined;
  let newLine = 0;

  const finishFile = () => {
    if (file) {
      file.language = languageOf(file.path);
      file.isTest = isTestFile(file.path);
      files.push(file);
    }
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      finishFile();
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      file = { path: m ? m[2]! : '', status: 'modified', binary: false, isTest: false, hunks: [] };
      hunk = undefined;
      continue;
    }
    if (!file) continue;
    if (hunk === undefined) {
      if (line.startsWith('new file mode')) { file.status = 'added'; continue; }
      if (line.startsWith('deleted file mode')) { file.status = 'deleted'; continue; }
      if (line.startsWith('rename from ')) { file.status = 'renamed'; file.oldPath = line.slice(12); continue; }
      if (line.startsWith('rename to ')) { file.path = line.slice(10); continue; }
      if (line.startsWith('Binary files ')) { file.binary = true; continue; }
      if (line.startsWith('--- ')) {
        const p = line.slice(4);
        if (p !== '/dev/null' && file.status === 'deleted') file.path = stripPrefix(p);
        continue;
      }
      if (line.startsWith('+++ ')) {
        const p = line.slice(4);
        if (p !== '/dev/null') file.path = stripPrefix(p);
        continue;
      }
    }
    const hm = HUNK_RE.exec(line);
    if (hm) {
      const oldStart = Number(hm[1]);
      const oldCount = hm[2] === undefined ? 1 : Number(hm[2]);
      const newStart = Number(hm[3]);
      const newCount = hm[4] === undefined ? 1 : Number(hm[4]);
      const newRange = range(newStart, newCount);
      hunk = {
        id: `${file.path}:${newRange.start}-${newRange.end}`,
        file: file.path,
        oldRange: range(oldStart, oldCount),
        newRange,
        added: [],
        removed: [],
        addedLines: [],
      };
      file.hunks.push(hunk);
      newLine = newStart;
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('+')) {
      hunk.added.push(line.slice(1));
      hunk.addedLines.push(newLine++);
    } else if (line.startsWith('-')) {
      hunk.removed.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      newLine++;
    }
    // '\ No newline at end of file' and blank trailing lines are ignored
  }
  finishFile();
  return files;
}

function defaultBranch(repoRoot: string): string | undefined {
  const originHead = tryGit(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.trim();
  if (originHead) return originHead;
  for (const b of ['main', 'master', 'origin/main', 'origin/master']) {
    if (tryGit(repoRoot, ['rev-parse', '--verify', '--quiet', `${b}^{commit}`])) return b;
  }
  return undefined;
}

function resolveCommit(repoRoot: string, ref: string, role: 'base' | 'head'): string {
  const sha = tryGit(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])?.trim();
  if (!sha) {
    throw new RadarError(
      role === 'base' ? 'BASE_NOT_FOUND' : 'BAD_INPUT',
      `Cannot find ${role} commit "${ref}". In GitHub Actions use actions/checkout with fetch-depth: 0.`,
    );
  }
  return sha;
}

export function getChangeSet(repoRoot: string, rangeArg?: string): ChangeSet {
  if (!tryGit(repoRoot, ['rev-parse', '--is-inside-work-tree'])) {
    throw new RadarError('NOT_A_REPO', `${repoRoot} is not inside a git repository.`);
  }
  let base: string;
  let head: string;
  if (rangeArg) {
    const parts = rangeArg.split(/\.\.\.?/);
    if (parts.length !== 2 || !parts[0]) throw new RadarError('BAD_INPUT', `Range must look like base..head, got "${rangeArg}".`);
    base = resolveCommit(repoRoot, parts[0], 'base');
    head = resolveCommit(repoRoot, parts[1] || 'HEAD', 'head');
  } else {
    head = resolveCommit(repoRoot, 'HEAD', 'head');
    const branch = defaultBranch(repoRoot);
    if (!branch) throw new RadarError('BASE_NOT_FOUND', 'No default branch found. Pass an explicit range like main..HEAD. In GitHub Actions use fetch-depth: 0.');
    const mb = tryGit(repoRoot, ['merge-base', branch, head])?.trim();
    if (!mb) throw new RadarError('BASE_NOT_FOUND', `No merge-base between ${branch} and HEAD. In GitHub Actions use actions/checkout with fetch-depth: 0.`);
    base = mb;
  }
  const text = git(repoRoot, ['diff', '--no-color', '--no-ext-diff', '-U0', '-M', base, head]);
  return { base, head, files: parseUnifiedDiff(text) };
}
