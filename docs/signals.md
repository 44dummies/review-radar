# Signals

Every signal looks at the change and returns **evidence**: a sentence plus a weight, attached to a hunk. A hunk's score is `min(100, sum of its weights)`. Tiers: **P0 ≥ 70**, **P1 ≥ 40**, **P2 below 40** (change with `tiers:`).

All weights below are defaults. Override any of them under `weights:` in `.reviewradar.yml`.

## sensitive-path

Flags hunks in files whose path matches a sensitive pattern, and hunks that add dangerous code.

| Weight key | Default | Meaning |
|---|---|---|
| `sensitivePath` | 45 | path matches one of `sensitivePaths` (auth, session, token, jwt, oauth, passw, secret, credential, crypto, encrypt, permission, rbac, acl, payment, billing, checkout, stripe, mpesa, invoice, migrations, `.env`, `Dockerfile`, `.github/workflows`) |
| `sensitiveCode` | 35 | added lines match one of `sensitiveCode` (child_process, exec, eval, `new Function`, dangerouslySetInnerHTML, subprocess, os.system, pickle.loads, yaml.load, bcrypt, jwt.sign/verify, createHash/createCipher, innerHTML =, `verify=False`, `rejectUnauthorized: false`) |

Add your own patterns (case-insensitive regex sources) with `sensitivePaths:` and `sensitiveCode:`. They're appended to the defaults.

## blast-radius

Counts how many files import the changed file (TypeScript, JavaScript and Python import graphs via tree-sitter, cached per commit in `.reviewradar-cache/`).

| Weight key | Default |
|---|---|
| `blastRadiusPerImporter` | 3 |
| `blastRadiusMax` | 30 |

## untested-change

Flags added code that no test covers. With `--lcov`, it uses real line coverage ("0 of 12 changed lines covered"). Without it, it falls back to "no test file imports this file or mentions the changed symbols".

| Weight key | Default |
|---|---|
| `untestedChange` | 25 |

## test-gaming

Only looks at test files. Rules: `test-file-deleted`, `skip-added` (`.skip`, `xit`, `pytest.mark.skip`/`xfail`, `unittest.skip`), `only-added` (`.only`, `fit`, `fdescribe`), `assertions-removed` (net fewer assertions), `matcher-weakened` (`toBe(x)` → `toBeDefined()` and friends).

| Weight key | Default |
|---|---|
| `testGaming` | 70 (P0 on its own) |

## dependency-change

| Weight key | Default | Meaning |
|---|---|---|
| `dependencyManifest` | 30 | new dependency in package.json, composer.json, requirements*.txt, pyproject.toml, Pipfile, go.mod, Cargo.toml, Gemfile |
| `dependencyMajor` | +20 | major version bump of an existing dependency |
| `dependencyLockfile` | 10 | lockfile changed |

## churn

How often the file changed in the last `churnDays` (default 90). Turned off on shallow clones; use `fetch-depth: 0`.

| Weight key | Default |
|---|---|
| `churnPerChange` | 2 |
| `churnMin` | 3 |
| `churnMax` | 20 |

## size

| Weight key | Default |
|---|---|
| `sizePer10Lines` | 2 |
| `sizeMin` | 20 lines |
| `sizeMax` | 20 |

## diffusion

PR-level evidence added to every hunk when the PR touches at least `diffusion.files` files (10) or `diffusion.dirs` directories (5).

| Weight key | Default |
|---|---|
| `diffusion` | 10 |

## external-sarif

Each result from a `--sarif` file that lands inside a changed hunk.

| Weight key | Default |
|---|---|
| `sarifError` | 40 |
| `sarifWarning` | 20 |
| `sarifNote` | 5 |

## Ignoring files

`ignore:` takes globs. Defaults: `dist/**`, `build/**`, `vendor/**`, `*.min.js` (at any depth). Binary files are listed as skipped.
