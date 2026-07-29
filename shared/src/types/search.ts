/**
 * Search results.
 *
 * Note what is *not* here: the query. A search response never echoes back what
 * the user typed, so a cached response contains no user input at all. That is
 * deliberate and load-bearing — it is what lets search results be cached
 * without any of the caching being a record of what anyone searched for.
 */

export interface SearchHit {
  number: string;
  name: string;
  status: string;
  type?: string;
  incorporatedOn?: string;
  cessationOn?: string;
  /** One-line address as Companies House renders it, for disambiguation. */
  addressSnippet?: string;
}

export interface SearchResponse {
  hits: SearchHit[];
  /** Total matches upstream, which may exceed the number returned. */
  totalResults: number;
  fetchedAt: string;
}
