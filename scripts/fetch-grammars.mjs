// Downloads official tree-sitter grammar wasm files into packages/core/grammars.
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PKGS = {
  'tree-sitter-typescript@0.23.2': ['tree-sitter-typescript.wasm', 'tree-sitter-tsx.wasm'],
  'tree-sitter-javascript@0.25.0': ['tree-sitter-javascript.wasm'],
  'tree-sitter-python@0.25.0': ['tree-sitter-python.wasm'],
};
const out = join(import.meta.dirname, '..', 'packages', 'core', 'grammars');
mkdirSync(out, { recursive: true });

for (const [spec, files] of Object.entries(PKGS)) {
  const dir = mkdtempSync(join(tmpdir(), 'rr-g-'));
  execSync(`npm pack ${spec} --silent`, { cwd: dir }); // spec is a constant above
  const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'));
  execFileSync('tar', ['xzf', tgz], { cwd: dir });
  for (const f of files) copyFileSync(join(dir, 'package', f), join(out, f));
  console.log(`vendored ${files.join(', ')} from ${spec}`);
}
