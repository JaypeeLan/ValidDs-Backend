/**
 * MongoDB full-text search helpers for product discovery.
 * Multi-word queries use phrase matching first to avoid OR-token noise.
 */

export function escapeMongoTextSearchToken(token: string): string {
  return token.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Search strings to try in order (phrase first for multi-word queries, then token AND).
 */
export function buildProductTextSearchStrings(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    return [escapeMongoTextSearchToken(tokens[0]!)];
  }

  const escaped = tokens.map(escapeMongoTextSearchToken);
  return [`"${escaped.join(' ')}"`, escaped.join(' ')];
}
