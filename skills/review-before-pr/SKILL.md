---
name: review-before-pr
description: Required before you open a pull request, write a PR description, or tell the user a branch is ready for review. Runs Review Radar on the branch plus uncommitted work to rank changed hunks (P0 must read, P1 should read, P2 skim), finds and undoes test gaming in your own changes (skipped tests, weakened or deleted assertions), and produces the "Where to look" section for the PR description.
---

# Review before opening a PR

Review Radar scores every changed hunk from 0 to 100 with plain-sentence evidence. It is deterministic and runs locally. By default it reviews this branch plus uncommitted and untracked changes against the default branch.

## Steps

1. **Run the review.** Call the `review_changes` tool (Review Radar MCP server) with no arguments.
   If the tool isn't available, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" --working-tree --format json` in the repository instead.

2. **Undo your own test gaming.** For every hunk whose evidence comes from the `test-gaming` signal and that touches code you changed in this task (a skipped or focused test, a deleted test, a removed assertion, or a strict matcher weakened to something like `toBeDefined()`):
   - restore the test or the strict assertion, and
   - fix the code under test so the real test passes.
   Only keep a skip if the user explicitly asked for it, and say so in the PR description.

3. **Never game the score.** Don't edit `.reviewradar.yml`, rename or move files, or split changes to lower a score. A high score on auth, payments or migrations is expected; it means a human should read it, not that you did something wrong.

4. **Re-run** `review_changes` and confirm the test-gaming evidence is gone. Run the project's tests.

5. **Hand it to the human.** Call `pr_review_guide` and put its markdown in the pull request description. If you're not opening a PR, show the user the P0 and P1 hunks with their reasons instead.
