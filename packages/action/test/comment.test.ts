import { describe, it, expect } from 'vitest';
import { upsertComment, type CommentApi } from '../src/comment';

function fakeApi(existing: { id: number; body: string }[]) {
  const calls: string[] = [];
  const api: CommentApi = {
    list: async () => existing,
    create: async (_t, body) => { calls.push(`create:${body}`); },
    update: async (_t, id, body) => { calls.push(`update:${id}:${body}`); },
  };
  return { api, calls };
}
const t = { owner: 'o', repo: 'r', issue_number: 1 };

describe('upsertComment', () => {
  it('creates when no marked comment exists', async () => {
    const { api, calls } = fakeApi([{ id: 5, body: 'hello' }]);
    expect(await upsertComment(api, t, '<!-- review-radar -->\nnew')).toBe('created');
    expect(calls).toEqual(['create:<!-- review-radar -->\nnew']);
  });
  it('updates the marked comment instead of posting again', async () => {
    const { api, calls } = fakeApi([{ id: 5, body: 'hello' }, { id: 9, body: '<!-- review-radar -->\nold' }]);
    expect(await upsertComment(api, t, '<!-- review-radar -->\nnew')).toBe('updated');
    expect(calls).toEqual(['update:9:<!-- review-radar -->\nnew']);
  });
});
