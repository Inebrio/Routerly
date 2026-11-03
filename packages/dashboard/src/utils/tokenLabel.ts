import type { RouterToken } from '../api';

/**
 * How a router token is named on screen. A token has no name field: what
 * identifies it is the label its owner put on it, and failing that the visible
 * head of the secret, which is what the token pages already show.
 */
export function tokenLabel(token: RouterToken): string {
  return token.labels?.[0] ?? token.tokenSnippet ?? token.id.slice(0, 8);
}
