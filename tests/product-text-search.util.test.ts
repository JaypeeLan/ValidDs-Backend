import {
  buildProductTextSearchStrings,
  escapeMongoTextSearchToken,
} from '../src/utils/product-text-search.util';

describe('product-text-search.util', () => {
  it('escapes quotes in tokens', () => {
    expect(escapeMongoTextSearchToken('foo"bar')).toBe('foo\\"bar');
  });

  it('uses phrase search for multi-word queries', () => {
    expect(buildProductTextSearchStrings('Adult Classic Clogs')).toEqual([
      '"Adult Classic Clogs"',
      'Adult Classic Clogs',
    ]);
  });

  it('uses a single token for one-word queries', () => {
    expect(buildProductTextSearchStrings('Crocs')).toEqual(['Crocs']);
  });
});
