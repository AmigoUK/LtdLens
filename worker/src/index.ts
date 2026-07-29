/**
 * The Worker exists for exactly one reason: so users never need their own
 * Companies House API key. It returns normalised register facts and nothing
 * else — no verdicts, no scores, no record of who asked.
 *
 * Implemented in v0.1.0.
 */

export default {
  fetch(): Response {
    return new Response('Not implemented', { status: 501 });
  },
};
