import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const json = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));

describe('claude code plugin', () => {
  it('marketplace lists the plugin from the repo root', () => {
    const m = json('.claude-plugin/marketplace.json');
    expect(m.name).toBe('review-radar');
    expect(m.owner.name).toBeTruthy();
    expect(m.plugins).toEqual([expect.objectContaining({ name: 'review-radar', source: './' })]);
  });
  it('plugin version matches the npm package', () => {
    expect(json('.claude-plugin/plugin.json').version).toBe(json('packages/cli/package.json').version);
  });
  it('runs the committed bundle as its MCP server', () => {
    expect(json('.claude-plugin/plugin.json').mcpServers['review-radar']).toEqual({
      command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs', 'mcp'],
    });
    expect(existsSync(join(root, 'dist/cli.mjs'))).toBe(true);
  });
  it('ships the review-before-pr skill with valid frontmatter', () => {
    const md = readFileSync(join(root, 'skills/review-before-pr/SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(md)?.[1] ?? '';
    expect(fm).toMatch(/^name: review-before-pr$/m);
    const desc = /^description: (.+)$/m.exec(fm)?.[1] ?? '';
    expect(desc.length).toBeGreaterThan(50);
    expect(desc.length).toBeLessThanOrEqual(1024);
    // Directive wording auto-triggered 2/2 headless runs vs 1/2 for "Use before…" (e2e 2026-10-11)
    expect(desc).toMatch(/^Required before you open a pull request/);
    expect(md).toContain('review_changes');
    expect(md).toContain('pr_review_guide');
  });
});
