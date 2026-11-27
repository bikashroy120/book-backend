import { slugify } from './slug';

describe('slugify', () => {
  it('keeps the existing default limit and accepts a shorter limit', () => {
    expect(slugify('A'.repeat(40))).toHaveLength(30);
    expect(slugify('A'.repeat(40), 12)).toHaveLength(12);
  });
});
