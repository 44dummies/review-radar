import * as core from '@actions/core';
import * as github from '@actions/github';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, renderMarkdown, renderSarif } from '@review-radar/core';
import { upsertComment, topAnnotations, type CommentApi } from './comment';

async function run(): Promise<void> {
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const sarifPaths = core.getInput('sarif').split(',').map((s) => s.trim()).filter(Boolean);
  const lcovPath = core.getInput('lcov') || undefined;
  const failOn = core.getInput('fail_on');
  const token = core.getInput('github_token');
  const pr = github.context.payload.pull_request as { number: number; base: { sha: string }; head: { sha: string } } | undefined;

  const range = pr ? `${pr.base.sha}...${pr.head.sha}` : undefined; // three-dot: diff from merge-base (PR semantics)
  const map = await analyze({ repoRoot: workspace, range, sarifPaths, lcovPath, useCache: false });
  const md = renderMarkdown(map, { marker: true });

  await core.summary.addRaw(md).write();

  for (const a of topAnnotations(map)) {
    core.error(a.message, { file: a.file, startLine: a.startLine, endLine: a.endLine, title: a.title });
  }

  const sarifFile = join(process.env.RUNNER_TEMP ?? workspace, 'review-radar.sarif');
  writeFileSync(sarifFile, renderSarif(map));
  core.setOutput('sarif-file', sarifFile);
  core.setOutput('p0', String(map.summary.p0));
  core.setOutput('p1', String(map.summary.p1));

  if (pr && token) {
    const octokit = github.getOctokit(token);
    const api: CommentApi = {
      list: async (t) => octokit.paginate(octokit.rest.issues.listComments, { ...t, per_page: 100 }),
      create: async (t, body) => { await octokit.rest.issues.createComment({ ...t, body }); },
      update: async (t, id, body) => { await octokit.rest.issues.updateComment({ owner: t.owner, repo: t.repo, comment_id: id, body }); },
    };
    try {
      const result = await upsertComment(api, { ...github.context.repo, issue_number: pr.number }, md);
      core.info(`review-radar: PR comment ${result}`);
    } catch (e) {
      core.warning(`review-radar: could not write PR comment (${(e as Error).message}). Grant "pull-requests: write". The job summary still has the report.`);
    }
  }

  if (failOn === 'P0' && map.summary.p0 > 0) core.setFailed(`${map.summary.p0} P0 hunk(s) need review`);
  if (failOn === 'P1' && map.summary.p0 + map.summary.p1 > 0) core.setFailed(`${map.summary.p0 + map.summary.p1} P0/P1 hunk(s) need review`);
}

run().catch((e) => core.setFailed((e as Error).message));
