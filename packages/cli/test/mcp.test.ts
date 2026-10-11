import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../src/mcp';
import { makeRepo } from '../../core/test/helpers/repo';

async function connect(cwd: string) {
  const server = createMcpServer(cwd);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientT);
  return client;
}

/** main has a test file and a util; the uncommitted work skips the test and tweaks the util. */
function repo() {
  const r = makeRepo();
  r.write({ 'src/a.test.ts': "it('a', () => {});\n", 'src/util.ts': 'export const u = 1;\n' });
  const base = r.commit('init');
  r.write({ 'src/a.test.ts': "it.skip('a', () => {});\n", 'src/util.ts': 'export const u = 2;\n' });
  return { r, base };
}

type Payload = { summary: { p0: number }; hunks: { tier: string; file: string; startLine: number }[] };
const text = (res: { content: unknown }) => (res.content as { type: string; text: string }[])[0]!.text;

describe('mcp server', () => {
  it('lists both tools, with an output schema on review_changes', async () => {
    const client = await connect(repo().r.root);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['pr_review_guide', 'review_changes']);
    expect(tools.find((t) => t.name === 'review_changes')!.outputSchema).toBeTruthy();
  });
  it('review_changes defaults to the working tree and P1+', async () => {
    const client = await connect(repo().r.root);
    const res = await client.callTool({ name: 'review_changes', arguments: {} });
    const p = res.structuredContent as Payload;
    expect(res.isError).toBeFalsy();
    expect(p.hunks[0]).toMatchObject({ tier: 'P0', file: 'src/a.test.ts', startLine: 1 });
    expect(p.hunks.every((h) => h.tier !== 'P2')).toBe(true);
    expect(text(res)).toContain('est. review time');
  });
  it('minTier P2 includes low-risk hunks', async () => {
    const client = await connect(repo().r.root);
    const res = await client.callTool({ name: 'review_changes', arguments: { minTier: 'P2' } });
    expect((res.structuredContent as Payload).hunks.map((h) => h.file)).toContain('src/util.ts');
  });
  it('an explicit range reviews committed changes only', async () => {
    const { r, base } = repo();
    r.commit('work');
    r.write({ 'src/extra.ts': 'export const x = 1;\n' }); // untracked: must not appear with a range
    const client = await connect(r.root);
    const res = await client.callTool({ name: 'review_changes', arguments: { range: `${base}..HEAD`, minTier: 'P2' } });
    const files = (res.structuredContent as Payload).hunks.map((h) => h.file);
    expect(files).toContain('src/a.test.ts');
    expect(files).toContain('src/util.ts');
    expect(files).not.toContain('src/extra.ts');
  });
  it('path pointing at a subdirectory still reviews the whole repo with repo-relative files', async () => {
    const { r } = repo();
    const client = await connect(r.root);
    const res = await client.callTool({ name: 'review_changes', arguments: { path: 'src' } });
    expect((res.structuredContent as Payload).hunks[0]!.file).toBe('src/a.test.ts');
  });
  it('pr_review_guide returns the Where to look markdown', async () => {
    const client = await connect(repo().r.root);
    const res = await client.callTool({ name: 'pr_review_guide', arguments: {} });
    expect(text(res)).toMatch(/^## Where to look\n/);
    expect(text(res)).toContain('`src/a.test.ts:1`');
  });
  it('errors come back as tool errors and the server keeps serving', async () => {
    const { r } = repo();
    const client = await connect(r.root);
    const outside = mkdtempSync(join(tmpdir(), 'rr-norepo-'));
    const bad = await client.callTool({ name: 'review_changes', arguments: { path: outside } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('not inside a git repository');
    const badRange = await client.callTool({ name: 'review_changes', arguments: { range: 'nope..HEAD' } });
    expect(badRange.isError).toBe(true);
    const ok = await client.callTool({ name: 'review_changes', arguments: {} });
    expect(ok.isError).toBeFalsy();
  });
});
