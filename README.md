# 📡 Review Radar

**Which lines of this AI-written PR do I actually need to read?**

Review Radar scores every hunk of a pull request from 0–100, sorts it into **P0 must-read / P1 should-read / P2 skim**, and tells you *why* in plain sentences. It's deterministic, runs offline, and needs no API key or LLM.

![Review Radar in the terminal](docs/img/terminal.png)

AI agents now write PRs faster than humans can review them. Teams either merge code nobody really read or let PRs pile up. Review Radar doesn't add another wall of AI comments. It **removes reading**: it points you at the hunks that can hurt you and lets you skim the rest with a clear conscience.

## Install

### GitHub Action

```yaml
# .github/workflows/review-radar.yml
on: pull_request
permissions: { contents: read, pull-requests: write, security-events: write }
jobs:
  radar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with: { fetch-depth: 0 }
      - uses: 44dummies/review-radar@v1
```

You get **one** PR comment (edited on every push, never re-posted), a job summary, inline annotations on the riskiest lines, and results in GitHub code scanning (free on public repos).

![Review Radar PR comment](docs/img/pr-comment.png)

The same findings show up inline in **Files changed** through GitHub code scanning:

![Review Radar alert in GitHub code scanning](docs/img/code-scanning.png)

### CLI

```bash
npx review-radar                 # current branch vs main
npx review-radar main...HEAD     # PR-style range (from the merge-base)
npx review-radar --format md     # markdown | json | sarif | terminal
npx review-radar --fail-on P0    # exit 1 if anything must be read
```

## What it looks at

| Signal | Example evidence |
|---|---|
| **sensitive-path** | path `src/auth/session.ts` matches sensitive pattern `auth` · adds code matching `child_process` |
| **blast-radius** | 14 files import `src/core.ts` (e.g. src/api.ts, src/cli.ts, …) |
| **untested-change** | 32 changed lines in `pay.ts`; no test file imports it or mentions `charge` |
| **test-gaming** | skips a test (`.skip`/`xit`/`pytest.mark.skip`) · replaces a strict assertion with a weaker one |
| **dependency-change** | adds dependency `left-pad@^1.3.0` · bumps `react` 18 → 19 (major) |
| **churn** | file changed 7 times in the last 90 days |
| **size / diffusion** | hunk changes 64 lines · PR touches 23 files across 9 directories |
| **external-sarif** | Semgrep js.sqli: SQL injection |

The import graph and test detection understand **TypeScript, JavaScript and Python** (via tree-sitter). Every other language still gets path, diff, git and SARIF signals.

Weights, thresholds and how to tune them: [docs/signals.md](docs/signals.md).

## Bring your scanners

Review Radar merges in any SARIF 2.1.0 file, from tools like Semgrep, CodeQL, [noskip](https://github.com/DariusHQ/noskip) and [open-code-review](https://github.com/alibaba/open-code-review). A finding that lands inside a changed hunk raises that hunk's score, so your existing tools decide *what's* wrong and Review Radar decides *where to look first*.

```yaml
- uses: 44dummies/review-radar@v1
  with:
    sarif: semgrep.sarif,noskip.sarif
    lcov: coverage/lcov.info      # optional: real line coverage for untested-change
    fail-on: P0                   # optional: block merges until P0s are reviewed
```

## AI-authorship badge

When commits carry agent trailers (`Co-Authored-By: Claude`, Copilot, Cursor, Codex, Devin…), bot authors, or "Generated with" footers, the comment is labelled **🤖 Likely AI-authored**. Contribution guides ask for this disclosure, and it's often skipped.

## Why not just an AI reviewer?

AI reviewers add text you have to read. Review Radar subtracts it, and every score comes with evidence you can check in seconds. **Use both:** point your AI reviewer at the P0s.

| | AI review bots | Review Radar |
|---|---|---|
| Output | More comments | A ranked reading list |
| Reproducible | No (sampling) | Yes (same diff → same scores) |
| Needs API key / sends code out | Usually | Never |
| Cost per PR | Tokens | Free |

## Configure

Add a `.reviewradar.yml` to your repo root. Every key is optional:

```yaml
weights:
  testGaming: 90          # make test tampering an instant P0
tiers: { p0: 70, p1: 40 }
sensitivePaths: ["ledger", "kyc"]
ignore: ["**/generated/**", "**/*.snap"]
```

## How it works

```
git diff ──▶ hunks ──▶ signals (9, independent) ──▶ score = min(100, Σ weights) ──▶ terminal · md · json · sarif
repo     ──▶ import graph (tree-sitter) · git history
*.sarif  ──▶ external findings
```

Each signal is one small file in [`packages/core/src/signals`](packages/core/src/signals). Adding one (Go imports, Terraform IAM, Rust `unsafe`…) is a great first PR.

## Roadmap

- **v1.1**: MCP server + Claude Code / Codex skill, so agents can see where reviewers will look *before* opening the PR
- **v1.2**: optional LLM explainer for P0 hunks
- More languages for the import graph (community signals welcome)

## License

MIT
