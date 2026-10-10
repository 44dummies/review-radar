# Review Radar — Design Spec

**Date:** 2026-10-11
**Status:** Approved (brainstorm sections 1–4 approved in conversation)
**Research basis:** `OneDrive\Documents\Research\ai-oss-project-opportunities-2026-10-11.md`

## 1. Purpose

Review Radar tells a human reviewer **which lines of a pull request they must read, and why**. It targets AI-written PRs, where review burden (22% top-3 pain point, +6 pts QoQ; 37% of write-ins report under-reviewed merges) is rising faster than any other developer complaint.

It is **deterministic and LLM-free in v1**: every score is reproducible, runs offline, needs no API key, and is accompanied by plain-sentence evidence. Prior just-in-time defect-prediction tools failed adoption because nobody could tell *why* a change was flagged (JITBot, ASE 2020). Evidence-first is the core design rule.

**Success criteria for v1.0**
- `npx review-radar` on any git repo prints a ranked risk map in < 10 s for a typical PR (≤ 50 files).
- `uses: 44dummies/review-radar@v1` adds one sticky PR comment, a job summary, top-10 annotations, and a SARIF upload with ≤ 5 lines of workflow YAML.
- Each P0/P1 hunk shows at least one concrete evidence line.
- The Action runs on Review Radar's own PRs (dogfood).

## 2. Scope

### In v1.0
- Input: `base..head` diff (default: merge-base with default branch), repo checkout, zero or more SARIF files.
- Languages with AST-level signals: **TypeScript, JavaScript, Python**. All other languages get path/diff/git-level signals.
- Surfaces: **CLI** and **GitHub Action**.
- Output formats: terminal, markdown, JSON, SARIF 2.1.0.

### Out of v1.0 (planned)
- v1.1: MCP server + Claude Code / Codex skill (consume the JSON contract).
- v1.2: optional LLM explainer layer.
- Later: GitLab, web dashboard, additional language grammars (community-contributed signals).

## 3. Architecture

```
                ┌──────────────────────────────────────────────┐
  git diff ───▶ │ 1. DiffParser   → ChangeSet{files, hunks}    │
  repo     ───▶ │ 2. Context      → ImportGraph (tree-sitter)  │
  *.sarif  ───▶ │                 → GitHistory (churn, age)    │
                │ 3. Signal[]     → Evidence[] per hunk        │
                │ 4. Scorer       → score 0–100 + tier         │
                │ 5. Reporter     → terminal | md | json | sarif│
                └──────────────────────────────────────────────┘
```

### 3.1 Repository layout (npm workspaces, TypeScript, Node ≥ 20)

```
review-radar/
  packages/
    core/        # parser, context, signals, scorer, reporters — no network
    cli/         # bin: review-radar
    action/      # GitHub Action wrapper (dist bundled with ncc/esbuild)
  fixtures/      # per-signal fixture diffs + mini repo trees
  docs/
  action.yml
  .reviewradar.yml (example)
```

### 3.2 Core types

```ts
interface ChangeSet { base: string; head: string; files: ChangedFile[] }
interface ChangedFile { path: string; status: 'added'|'modified'|'deleted'|'renamed'; language?: Lang; hunks: Hunk[] }
interface Hunk { id: string; file: string; oldRange: Range; newRange: Range; added: string[]; removed: string[] }

interface Evidence { signal: string; weight: number; message: string; lines?: Range; ruleId?: string }
interface HunkRisk { hunk: Hunk; score: number; tier: 'P0'|'P1'|'P2'; evidence: Evidence[] }
interface RiskMap { changeSet: ChangeSet; hunks: HunkRisk[]; summary: Summary; meta: { version: string; aiAuthored?: AiAuthorship } }

interface Signal {
  name: string;
  run(changeSet: ChangeSet, ctx: Context): Promise<Evidence[]>;
}
interface Context { repoRoot: string; importGraph: ImportGraph; git: GitHistory; sarif: SarifResult[]; config: Config }
```

### 3.3 Signals (v1.0)

| Signal | Evidence produced | Source |
|---|---|---|
| `sensitive-path` | path or symbol matches auth / payment / crypto / secrets / permissions / migrations patterns (configurable list) | path + AST identifiers |
| `blast-radius` | N files import the changed module | ImportGraph (reverse edges) |
| `untested-change` | changed symbols referenced by 0 test files; optional LCOV coverage of changed lines | AST + test-file heuristics, LCOV if present |
| `test-gaming` | skip/only added, test file deleted, assertions removed, matcher weakened | diff of test files, AST for TS/JS/Py |
| `dependency-change` | manifest/lockfile edits, new packages, major version jumps | path + diff |
| `churn` | file changed N times in last 90 days | `git log` |
| `size` | lines added/removed in hunk and file | diff |
| `diffusion` | PR touches N files across M directories | diff |
| `external-sarif` | each SARIF result mapped to the hunk it lands on; message = tool + rule + text | SARIF input |

Each signal is one file in `packages/core/src/signals/` plus one registration line. A signal that throws is reported as "signal X skipped: reason" and the run continues.

### 3.4 Context builders

- **ImportGraph**: tree-sitter queries extract `import` / `require` / `from … import` for TS/JS/Py; relative paths resolved; reverse map built (`importedBy`). Scoped to repo, cached under `.reviewradar-cache/<sha>.json`. Grammars ship as prebuilt `.wasm` inside `core` so `npx` works with no build step (candidate source: `tree-sitter-wasms`; verify at implementation).
- **GitHistory**: `git log --since=90.days --name-only` parsed once per run.
- **AiAuthorship**: bot author login, `Co-Authored-By` trailers naming known agents, agent commit signatures. Produces a badge, not a score input.

### 3.5 Scorer

`score = min(100, Σ evidence.weight)`. Default weights in `packages/core/src/config/defaults.ts`; overridable in `.reviewradar.yml`. Tiers: **P0 ≥ 70, P1 ≥ 40, P2 < 40**. Evidence list is always emitted with the score.

### 3.6 Reporters

- **terminal** (default): ranked list, P0 first; `file:lines`, score bar, tier, evidence indented. Footer: `12 hunks · 2 P0 · 3 P1 · 7 P2 · est. review time 18 min` (estimate = lines × per-tier rate; labeled estimate).
- **md**: heatmap strip table (file · score · tier) + `<details>` per hunk. Used for PR comment and job summary.
- **json**: full `RiskMap`. Stable contract for MCP/skill.
- **sarif**: one result per P0/P1 hunk; `level` error/warning; `ruleId` = signal name; message = evidence. P2 omitted. Validated against SARIF 2.1.0 schema.

## 4. CLI

```
npx review-radar [<base>..<head>] [--sarif <file>]... [--format terminal|md|json|sarif]
                 [--out <file>] [--fail-on P0|P1] [--config .reviewradar.yml] [--no-cache]
```
Exit codes: `0` OK, `1` findings at/above `--fail-on`, `2` error.

## 5. GitHub Action

```yaml
- uses: 44dummies/review-radar@v1
  with:
    sarif: results/semgrep.sarif   # optional, comma-separated
    fail-on: P0                    # optional
```
Permissions: `pull-requests: write`, `security-events: write`, `contents: read`.

Behaviour per run:
1. Run CLI with `--format json`.
2. Upsert one PR comment located by `<!-- review-radar -->` marker (edit, never re-post).
3. Write job summary (same markdown).
4. Emit ≤ 10 `::error` annotations for top P0 lines (GitHub caps 10/type/step, 50/job).
5. Upload SARIF via `github/codeql-action/upload-sarif` when permitted (free on public repos).
6. Show AI-authorship badge at top of comment.

## 6. Error handling

- No git history / shallow clone → churn and blast-radius degrade; message in summary.
- Unparseable file → path-level signals only for that file.
- SARIF parse error → reported, run continues.
- PR comment permission denied → fall back to job summary only, warn.

## 7. Testing

- **Unit (Vitest):** each signal has fixture diffs in `fixtures/<signal>/` with expected `Evidence[]`.
- **Scorer golden tests:** fixed evidence → fixed score/tier.
- **Reporter snapshots;** SARIF validated against schema.
- **E2E:** CLI against own history + two pinned public PRs (one human, one AI-authored); stable output.
- **Action:** exercised on a throwaway repo before `v1` tag.
- Target: ≥ 80% line coverage on `core`.

## 8. Launch plan

1. README: terminal + PR-comment screenshots above the fold; 5-line install; "why not just an AI reviewer".
2. Dogfood: Action enabled on this repo from first PR.
3. Day-one listings: GitHub Actions Marketplace, awesome-code-review, awesome-ai-agents; Claude plugin lists at v1.1.
4. HN post weekday morning US time (timing matters; "Show HN" tag doesn't); dev.to + r/programming write-up.
5. Cross-links: PRs/issues to noskip, Semgrep, open-code-review docs showing them as inputs.

## 9. Milestones

| Version | Contents |
|---|---|
| v1.0 | CLI + Action; TS/JS + Python signals; 4 reporters |
| v1.1 | MCP server + Claude/Codex skill over JSON contract |
| v1.2 | Optional LLM explainer |

## 10. Risks

- Commercial reviewers (Cubic, MergeShield, CodeRabbit) add line-level triage → mitigate with open, offline, free, and signal plug-ins.
- tree-sitter wasm performance in Node → scope parsing to changed files + their importers; cache graph.
- Annotation/comment noise → one sticky comment, P2 hidden by default.
