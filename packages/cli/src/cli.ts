#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, render, FORMATS, RadarError, VERSION, type Format } from '@review-radar/core';
import { startStdio } from './mcp';

const HELP = `Usage: review-radar [<base>...<head>] [options]
       review-radar mcp          Start the MCP server (stdio) for coding agents

Shows which hunks of a change need human review, and why.
With no range: current branch vs the merge-base with main. base...head diffs from
the merge-base (like a PR); base..head is a direct diff.

Options:
  --sarif <file>     Merge findings from another scanner (repeatable)
  --lcov <file>      Use an LCOV coverage report for untested-change
  --format <f>       terminal | md | json | sarif   (default: terminal)
  --out <file>       Write the report to a file instead of stdout
  --fail-on <tier>   Exit 1 if any hunk is at or above P0 | P1
  --config <file>    Config file (default: .reviewradar.yml)
  --working-tree     Also review uncommitted and untracked changes (no-range mode)
  --no-cache         Rebuild the import graph
  --no-color         Disable colors
  -v, --version      Print version
  -h, --help         Print this help
`;

/** True when this file is the entry script, even when launched through npm's bin symlink (npx). */
export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

interface IO { stdout: (s: string) => void; stderr: (s: string) => void; cwd: string }

export async function main(argv: string[], io: IO): Promise<number> {
  if (argv[0] === 'mcp') { startStdio(io.cwd); return 0; }
  let parsed;
  try {
    parsed = parseArgs({
      args: argv, allowPositionals: true, strict: true,
      options: {
        sarif: { type: 'string', multiple: true }, lcov: { type: 'string' }, format: { type: 'string', default: 'terminal' },
        out: { type: 'string' }, 'fail-on': { type: 'string' }, config: { type: 'string' },
        'no-cache': { type: 'boolean' }, 'working-tree': { type: 'boolean' }, 'no-color': { type: 'boolean' },
        version: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    io.stderr(`review-radar: ${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values: v, positionals } = parsed;
  if (v.help) { io.stdout(HELP); return 0; }
  if (v.version) { io.stdout(`${VERSION}\n`); return 0; }
  const format = v.format as Format;
  if (!FORMATS.includes(format)) { io.stderr(`review-radar: unknown --format "${v.format}" (use ${FORMATS.join(', ')})\n`); return 2; }
  const failOn = v['fail-on'];
  if (failOn && failOn !== 'P0' && failOn !== 'P1') { io.stderr('review-radar: --fail-on must be P0 or P1\n'); return 2; }

  try {
    const map = await analyze({
      repoRoot: io.cwd, range: positionals[0], sarifPaths: v.sarif, lcovPath: v.lcov,
      configPath: v.config, useCache: !v['no-cache'], workingTree: v['working-tree'],
    });
    const text = render(map, format, { color: !v['no-color'] && !v.out });
    if (v.out) writeFileSync(isAbsolute(v.out) ? v.out : join(io.cwd, v.out), text);
    else io.stdout(text);
    if (failOn === 'P0' && map.summary.p0 > 0) return 1;
    if (failOn === 'P1' && map.summary.p0 + map.summary.p1 > 0) return 1;
    return 0;
  } catch (e) {
    const msg = e instanceof RadarError ? e.message : (e as Error).stack ?? String(e);
    io.stderr(`review-radar: ${msg}\n`);
    return 2;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s), cwd: process.cwd(),
  }).then((code) => { process.exitCode = code; });
}
