/**
 * Runs the ruleset against a snapshot.
 *
 * The engine's one job beyond bookkeeping is to make a false clean bill of
 * health impossible. It does that in three ways:
 *
 * 1. A rule whose sources were not fetched is `not-checked`, never `clear`.
 * 2. A rule that cannot decide from the fields present says so, rather than
 *    defaulting to "does not apply".
 * 3. `all-clear` requires every source, so the reassuring message cannot be
 *    produced from a partial record.
 *
 * The engine runs in the browser, at render time, not on a server. That means a
 * rule fix ships with the extension and instantly corrects every cached report
 * — no cache purge, no redeploy — and it means the verdict is the user's reading
 * of a public record rather than a statement attv.uk publishes about a named
 * company.
 */

import type { CompanySnapshot, SnapshotSource, SourceStatus } from '../types/snapshot.js';
import type { Flag, FlagEvaluation, FlagId, Severity, Verdict } from '../types/flags.js';
import type { CalendarDate } from '../normalise/dates.js';
import { toCalendarDate } from '../normalise/dates.js';
import { companyRecordUrl } from '../normalise/companyNumber.js';
import type { RuleDefinition } from './rules.js';
import { LEVEL_ORDER, RULES, RULESET_VERSION } from './rules.js';

/** Where the guides explaining each flag live. */
const GUIDE_BASE = 'https://www.attv.uk/guides';

/**
 * A source counts as available when it was fetched, or when there was nothing
 * to fetch. "This company has no charges" is an answer; a skipped or failed
 * call is not.
 */
function isAvailable(status: SourceStatus): boolean {
  return status === 'ok' || status === 'not-applicable';
}

/** Sources a rule needs that are not available. */
function missingSources(
  rule: RuleDefinition,
  sources: Record<SnapshotSource, SourceStatus>,
): SnapshotSource[] {
  return rule.requires.filter((source) => !isAvailable(sources[source]));
}

function buildFlag(
  rule: RuleDefinition,
  snapshot: CompanySnapshot,
  params: Record<string, string | number> | undefined,
): Flag {
  const flag: Flag = {
    id: rule.id,
    level: rule.level,
    // An i18n key, not rendered text. A rendered English string here would
    // language-stamp anything cached and route the most visible text in the
    // product around the translation layer.
    labelKey: `flag.${rule.id}.label`,
    detailKey: `flag.${rule.id}.detail`,
    learnMoreUrl: `${GUIDE_BASE}/${rule.id}?utm_source=extension&utm_medium=flag&utm_campaign=${rule.id}`,
    // Required, never optional: every claim is one click from its proof.
    sourceUrl: companyRecordUrl(snapshot.number, rule.sourceSection),
  };
  if (params !== undefined && Object.keys(params).length > 0) flag.params = params;
  return flag;
}

/** Red beats amber beats green. `info` never lifts the pill. */
export function overallSeverity(flags: readonly Flag[]): Severity {
  if (flags.some((flag) => flag.level === 'red')) return 'red';
  if (flags.some((flag) => flag.level === 'amber')) return 'amber';
  return 'green';
}

export function evaluateSnapshot(snapshot: CompanySnapshot, now: CalendarDate): Verdict {
  const evaluations: FlagEvaluation[] = [];
  const raised: Flag[] = [];

  const runRule = (rule: RuleDefinition): void => {
    const missing = missingSources(rule, snapshot.sources);
    if (missing.length > 0) {
      evaluations.push({ status: 'not-checked', id: rule.id, missing });
      return;
    }

    const outcome = rule.evaluate(
      snapshot,
      now,
      raised.map((flag) => flag.id),
    );

    if (outcome === 'unknown') {
      // The source arrived but the field the rule needs was absent. Reporting
      // "clear" here would be a guess dressed as a finding.
      evaluations.push({ status: 'not-checked', id: rule.id, missing: [] });
      return;
    }

    if (outcome === false) {
      evaluations.push({ status: 'clear', id: rule.id });
      return;
    }

    const flag = buildFlag(rule, snapshot, outcome.params);
    raised.push(flag);
    evaluations.push({ status: 'raised', flag });
  };

  // First pass: the rules that read only the snapshot.
  for (const rule of RULES) {
    if (rule.derived !== true) runRule(rule);
  }

  // Second pass: rules that need to know what the first pass found.
  for (const rule of RULES) {
    if (rule.derived === true) runRule(rule);
  }

  const flags = [...raised].sort((a, b) => {
    const byLevel = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
    if (byLevel !== 0) return byLevel;
    // Within a level, keep the ruleset's own order so the reading is stable.
    return RULES.findIndex((r) => r.id === a.id) - RULES.findIndex((r) => r.id === b.id);
  });

  const notChecked = evaluations
    .filter(
      (evaluation): evaluation is Extract<FlagEvaluation, { status: 'not-checked' }> =>
        evaluation.status === 'not-checked',
    )
    .map((evaluation) => evaluation.id);

  return {
    evaluations,
    flags,
    notChecked,
    overall: overallSeverity(flags),
    // True when anything could not be evaluated — from a missing source or a
    // missing field. The panel must show this; it may never be suppressed to
    // make a report look tidier.
    partial: notChecked.length > 0,
    rulesetVersion: RULESET_VERSION,
  };
}

/** Convenience for callers holding a `Date` rather than a calendar date. */
export function evaluateSnapshotAt(snapshot: CompanySnapshot, now: Date): Verdict {
  return evaluateSnapshot(snapshot, toCalendarDate(now));
}

/** Every rule that did not run, with why. Used by the "not assessed" rows. */
export function notCheckedDetail(verdict: Verdict): { id: FlagId; missing: SnapshotSource[] }[] {
  return verdict.evaluations
    .filter(
      (evaluation): evaluation is Extract<FlagEvaluation, { status: 'not-checked' }> =>
        evaluation.status === 'not-checked',
    )
    .map(({ id, missing }) => ({ id, missing }));
}
