// Copies README + LICENSE into packages/cli for npm, with repo-relative links made absolute
// (npm can't resolve .github/assets/... or LICENSE relative to the package).
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const RAW = 'https://raw.githubusercontent.com/44dummies/review-radar/main/';
const BLOB = 'https://github.com/44dummies/review-radar/blob/main/';
const TREE = 'https://github.com/44dummies/review-radar/tree/main/';

const md = readFileSync(join(root, 'README.md'), 'utf8')
  .replace(/(src|srcset)="\.github\//g, `$1="${RAW}.github/`)
  .replace(/\]\(\.github\//g, `](${RAW}.github/`)
  .replace(/\]\(LICENSE\)/g, `](${BLOB}LICENSE)`)
  .replace(/\]\(packages\//g, `](${TREE}packages/`);
writeFileSync(join(root, 'packages/cli/README.md'), md);
copyFileSync(join(root, 'LICENSE'), join(root, 'packages/cli/LICENSE'));
console.log('packages/cli/README.md and LICENSE ready for npm');
