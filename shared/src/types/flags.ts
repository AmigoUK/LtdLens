/**
 * The flag vocabulary.
 *
 * The engine itself lands in v0.0.4; these types come first because the
 * snapshot contract is shaped by them — specifically by `requires`, which is
 * what makes "not checked" representable and therefore unavoidable.
 *
 * A flag states a fact from the register ("Accounts are overdue") and links to
 * the filing that proves it. It never states a conclusion ("unreliable",
 * "high risk"), and there is no aggregate score. A single number invites the
 * reader to stop thinking, and it is what earns a solicitor's letter; a list of
 * sourced, dated facts does neither.
 */

import type { SnapshotSource } from './snapshot.js';

/** Drives the summary pill. `info` is never severity — see `FlagLevel`. */
export type Severity = 'green' | 'amber' | 'red';

/**
 * `info` exists because some facts are worth showing without implying concern.
 * Outstanding charges are normal for any financed business; reporting them as
 * amber would flag half the healthy companies in the country. `info` rows are
 * displayed but never lift the pill.
 */
export type FlagLevel = Severity | 'info';

export type FlagId =
  | 'status-terminal'
  | 'strike-off'
  | 'accounts-overdue'
  | 'cs-overdue'
  | 'young-no-accounts'
  | 'officer-churn'
  | 'recent-move-young'
  | 'name-change'
  | 'charges-outstanding'
  | 'all-clear';

export interface Flag {
  id: FlagId;
  level: FlagLevel;
  /**
   * An i18n key, not rendered text. A rendered English string in the data model
   * would language-stamp anything cached and would route the most visible text
   * in the product around the translation layer entirely.
   */
  labelKey: string;
  params?: Record<string, string | number>;
  /** "Why this matters", also an i18n key. */
  detailKey?: string;
  learnMoreUrl?: string;
  /** Required, never optional: every claim is one click from its proof. */
  sourceUrl: string;
}

/**
 * The engine returns one of these per rule — never a bare `Flag[]`. A bare
 * array cannot distinguish "we checked and it is fine" from "we could not
 * check", so the type system would happily let a partial snapshot render as a
 * clean bill of health. This makes that unrepresentable.
 */
export type FlagEvaluation =
  | { status: 'raised'; flag: Flag }
  | { status: 'clear'; id: FlagId }
  | { status: 'not-checked'; id: FlagId; missing: SnapshotSource[] };

export interface Verdict {
  evaluations: FlagEvaluation[];
  /** Raised flags in display order: red, amber, info, then rule order. */
  flags: Flag[];
  notChecked: FlagId[];
  overall: Severity;
  /** True when anything could not be evaluated. Shown, never suppressed. */
  partial: boolean;
  rulesetVersion: string;
}
