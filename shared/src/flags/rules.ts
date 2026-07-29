/**
 * The flag ruleset.
 *
 * Every rule here states a **fact from the public register** and links to the
 * page that proves it. None states a conclusion. "Accounts are overdue" is a
 * fact; "unreliable", "high risk" or "do not trade" are inferences, and putting
 * an inference about a named UK company on screen is a different legal position
 * to be in. There is deliberately no aggregate score: a single number invites
 * the reader to stop thinking and is what earns a solicitor's letter, whereas a
 * list of sourced, dated facts does neither.
 *
 * Two structural properties matter more than any individual rule.
 *
 * **Each rule declares the sources it needs.** If those sources were not
 * fetched, the rule reports `not-checked` rather than `clear`. The engine cannot
 * express "this is fine" about something it never looked at.
 *
 * **A rule may also declare itself unable to decide.** Returning `'unknown'`
 * covers the case where the source arrived but the specific field is absent —
 * a profile with no incorporation date cannot answer "is this company young?",
 * and answering "no" would be a guess dressed as a finding.
 *
 * Rules are versioned as a set. `RULESET_VERSION` changes whenever a rule is
 * added, removed, or its threshold moves.
 */

import type { CompanySnapshot, SnapshotSource } from '../types/snapshot.js';
import type { FlagId, FlagLevel } from '../types/flags.js';
import type { CalendarDate } from '../normalise/dates.js';
import { isWithinMonths, monthsBetween, parseCalendarDate } from '../normalise/dates.js';

export const RULESET_VERSION = '1.0.0';

/**
 * What a rule concluded.
 *
 * - `false` — checked, does not apply.
 * - `'unknown'` — the source was there but the field needed was not.
 * - an object — applies, with any values the message interpolates.
 */
export type RuleOutcome = false | 'unknown' | { params?: Record<string, string | number> };

export interface RuleDefinition {
  id: FlagId;
  level: FlagLevel;
  /** Sources that must be `ok` or `not-applicable` for this rule to run. */
  requires: readonly SnapshotSource[];
  /** Companies House page that evidences the flag, appended to the company URL. */
  sourceSection?: string;
  /** Runs in a second pass and can see what the first pass raised. */
  derived?: boolean;
  evaluate(snapshot: CompanySnapshot, now: CalendarDate, raised?: readonly FlagId[]): RuleOutcome;
}

/**
 * Company statuses that mean the company is being wound up, has been, or is
 * under external control.
 *
 * Taken from the Companies House `company_status` enumeration. `registered` and
 * `open` are not here: they belong to overseas entities and are not terminal.
 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'dissolved',
  'liquidation',
  'receivership',
  'administration',
  'voluntary-arrangement',
  'insolvency-proceedings',
  'converted-closed',
  'closed',
  'removed',
]);

/** Age in whole months, or undefined when the register does not say. */
function ageInMonths(snapshot: CompanySnapshot, now: CalendarDate): number | undefined {
  const incorporated = parseCalendarDate(snapshot.incorporatedOn);
  return incorporated === undefined ? undefined : monthsBetween(incorporated, now);
}

export const RULES: readonly RuleDefinition[] = [
  {
    // The most severe thing the register can say, and it says it plainly.
    id: 'status-terminal',
    level: 'red',
    requires: ['profile'],
    evaluate(snapshot) {
      const status = snapshot.status.toLowerCase();
      return TERMINAL_STATUSES.has(status) ? { params: { status } } : false;
    },
  },

  {
    // A company can be "active" and simultaneously two months from being struck
    // off the register. Anyone extending credit needs to know that, and the
    // status field alone does not tell them.
    id: 'strike-off',
    level: 'red',
    requires: ['profile'],
    evaluate(snapshot) {
      return snapshot.statusDetail === 'active-proposal-to-strike-off' ? {} : false;
    },
  },

  {
    // Not a judgement about solvency — a statement that a legal filing deadline
    // has passed. It is also the earliest signal the register gives.
    id: 'accounts-overdue',
    level: 'red',
    requires: ['profile'],
    sourceSection: 'filing-history',
    evaluate(snapshot) {
      if (!snapshot.accounts.overdue) return false;
      const due = snapshot.accounts.nextDue;
      return due === undefined ? {} : { params: { dueDate: due } };
    },
  },

  {
    // Less severe than overdue accounts: the confirmation statement is a
    // fifteen-minute form, so missing it says more about administration than
    // about money. Still worth knowing that nobody is minding the paperwork.
    id: 'cs-overdue',
    level: 'amber',
    requires: ['profile'],
    sourceSection: 'filing-history',
    evaluate(snapshot) {
      if (!snapshot.confirmationStatement.overdue) return false;
      const due = snapshot.confirmationStatement.nextDue;
      return due === undefined ? {} : { params: { dueDate: due } };
    },
  },

  {
    // Not a criticism. A company incorporated last month has filed nothing
    // because nothing is due yet — the point is only that there is no trading
    // history to look at, which is a fact about the evidence, not the company.
    id: 'young-no-accounts',
    level: 'amber',
    requires: ['profile'],
    evaluate(snapshot, now) {
      if (snapshot.accounts.hasEverFiled) return false;
      const age = ageInMonths(snapshot, now);
      if (age === undefined) return 'unknown';
      return age < 12 ? { params: { months: age } } : false;
    },
  },

  {
    // Directors leaving in quick succession is the pattern that precedes a lot
    // of failures. The second limb catches the smaller case: a company down to
    // one director after somebody left.
    id: 'officer-churn',
    level: 'amber',
    requires: ['officers'],
    sourceSection: 'officers',
    evaluate(snapshot) {
      const { resignedLast6m, activeCount } = snapshot.officers;
      if (resignedLast6m >= 2) return { params: { count: resignedLast6m } };
      if (resignedLast6m >= 1 && activeCount <= 1) {
        return { params: { count: resignedLast6m, remaining: activeCount } };
      }
      return false;
    },
  },

  {
    // Either limb alone is unremarkable — companies move, and companies are
    // young. Together they are the shape of an entity that has not settled,
    // which is worth a second look before offering terms.
    id: 'recent-move-young',
    level: 'amber',
    requires: ['profile', 'filings'],
    sourceSection: 'filing-history',
    evaluate(snapshot, now) {
      const moved = parseCalendarDate(snapshot.registeredOfficeChangedOn);
      if (moved === undefined) return false;
      if (!isWithinMonths(moved, now, 3)) return false;

      const age = ageInMonths(snapshot, now);
      if (age === undefined) return 'unknown';
      return age < 24 ? { params: { movedOn: snapshot.registeredOfficeChangedOn! } } : false;
    },
  },

  {
    // Renaming is ordinary and legitimate. It matters here for one practical
    // reason: the name on the invoice may not be the name the counterparty
    // traded under when the relationship started, and searches miss it.
    id: 'name-change',
    level: 'amber',
    requires: ['profile', 'filings'],
    sourceSection: 'filing-history',
    evaluate(snapshot, now) {
      const renamed = parseCalendarDate(snapshot.nameChangedOn);
      if (renamed === undefined || !isWithinMonths(renamed, now, 12)) return false;
      const previous = snapshot.previousNames[0]?.name;
      return previous === undefined
        ? { params: { changedOn: snapshot.nameChangedOn! } }
        : { params: { changedOn: snapshot.nameChangedOn!, previousName: previous } };
    },
  },

  {
    // Information, never a warning. A charge is a lender taking security, which
    // is what happens on every commercial loan, mortgage and asset finance
    // agreement. Flagging it as concerning would mark most healthy trading
    // companies in the country.
    id: 'charges-outstanding',
    level: 'info',
    requires: ['charges'],
    sourceSection: 'charges',
    evaluate(snapshot) {
      const { outstanding } = snapshot.charges;
      return outstanding >= 1 ? { params: { count: outstanding } } : false;
    },
  },

  {
    // Requires every source, deliberately. "No red flags in the public record"
    // is a claim about the whole record, and it must not be made on the strength
    // of a partial one. If anything was skipped or failed, this rule reports
    // not-checked and the panel never shows the reassuring message.
    id: 'all-clear',
    level: 'green',
    requires: ['profile', 'officers', 'charges', 'filings'],
    derived: true,
    evaluate(snapshot, now, raised = []) {
      const concerning = raised.filter((id) => id !== 'charges-outstanding' && id !== 'all-clear');
      if (concerning.length > 0) return false;
      if (snapshot.status.toLowerCase() !== 'active') return false;

      const age = ageInMonths(snapshot, now);
      if (age === undefined) return 'unknown';
      // Under three years the register simply has less to say, so the all-clear
      // is qualified rather than withheld.
      return { params: { established: age >= 36 ? 'established' : 'young' } };
    },
  },
];

export const RULES_BY_ID: ReadonlyMap<FlagId, RuleDefinition> = new Map(
  RULES.map((rule) => [rule.id, rule]),
);

/** Display order: red first, then amber, then info, then green. */
export const LEVEL_ORDER: Record<FlagLevel, number> = {
  red: 0,
  amber: 1,
  info: 2,
  green: 3,
};
