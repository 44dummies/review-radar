import { describe, it, expect } from 'vitest';
import { RadarError, tierFor } from '../src/index';

describe('core basics', () => {
  it('RadarError carries a code', () => {
    const e = new RadarError('BASE_NOT_FOUND', 'missing');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('BASE_NOT_FOUND');
    expect(e.message).toBe('missing');
  });
  it('tierFor maps score to tier at the spec thresholds', () => {
    expect(tierFor(70)).toBe('P0');
    expect(tierFor(69)).toBe('P1');
    expect(tierFor(40)).toBe('P1');
    expect(tierFor(39)).toBe('P2');
    expect(tierFor(0)).toBe('P2');
  });
});
