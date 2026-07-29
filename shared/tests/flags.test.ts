import { describe, expect, it } from 'vitest';
import { evaluateSnapshot, notCheckedDetail, overallSeverity } from '../src/flags/engine.js';
import { RULES, RULESET_VERSION } from '../src/flags/rules.js';
import type { CompanySnapshot, SnapshotSource, SourceStatus } from '../src/types/snapshot.js';
import { SNAPSHOT_SCHEMA } from '../src/types/snapshot.js';
import type { CalendarDate } from '../src/normalise/dates.js';
import type { Flag, FlagId, FlagLevel } from '../src/types/flags.js';

const NOW: CalendarDate = { year: 2026, month: 7, day: 29 };

/**
 * A healthy, long-established company with every source available. Every test
 * starts here and changes exactly one thing, so a failure names its own cause.
 *
 * Source availability is a separate argument rather than part of `overrides`,
 * so that changing one source does not require restating the other three.
 */
function snapshot(
  overrides: Partial<CompanySnapshot> = {},
  sourceOverrides: Partial<Record<SnapshotSource, SourceStatus>> = {},
): CompanySnapshot {
  const sources: Record<SnapshotSource, SourceStatus> = {
    profile: 'ok',
    officers: 'ok',
    charges: 'ok',
    filings: 'ok',
    ...overrides.sources,
    ...sourceOverrides,
  };

  return {
    schema: SNAPSHOT_SCHEMA,
    number: '00445790',
    name: 'STEADY TRADING LIMITED',
    status: 'active',
    incorporatedOn: '2005-04-01',
    sicCodes: ['47110'],
    registeredOffice: { inDispute: false, undeliverable: false },
    accounts: { overdue: false, hasEverFiled: true },
    confirmationStatement: { overdue: false },
    officers: { activeCount: 4, resignedCount: 3, appointedLast6m: 0, resignedLast6m: 0 },
    charges: { outstanding: 0, satisfied: 0, partSatisfied: 0 },
    recentFilings: [],
    previousNames: [],
    hasInsolvencyHistory: false,
    partial: false,
    fetchedAt: '2026-07-29T10:00:00.000Z',
    ...overrides,
    sources,
  };
}

const idsOf = (verdict: ReturnType<typeof evaluateSnapshot>): FlagId[] =>
  verdict.flags.map((flag) => flag.id);

describe('the ruleset as a whole', () => {
  it('is versioned, so a cached report can be traced to the rules that produced it', () => {
    expect(RULESET_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(evaluateSnapshot(snapshot(), NOW).rulesetVersion).toBe(RULESET_VERSION);
  });

  it('evaluates every rule exactly once', () => {
    const verdict = evaluateSnapshot(snapshot(), NOW);
    expect(verdict.evaluations).toHaveLength(RULES.length);
    const seen = verdict.evaluations.map((evaluation) =>
      evaluation.status === 'raised' ? evaluation.flag.id : evaluation.id,
    );
    expect(new Set(seen).size).toBe(RULES.length);
  });

  it('is deterministic', () => {
    const input = snapshot({ accounts: { overdue: true, hasEverFiled: true } });
    expect(evaluateSnapshot(input, NOW)).toEqual(evaluateSnapshot(input, NOW));
  });

  it('gives every raised flag a source URL pointing at the proof', () => {
    const verdict = evaluateSnapshot(
      snapshot({
        accounts: { overdue: true, hasEverFiled: true },
        charges: { outstanding: 2, satisfied: 0, partSatisfied: 0 },
      }),
      NOW,
    );
    for (const flag of verdict.flags) {
      expect(flag.sourceUrl).toContain(
        'find-and-update.company-information.service.gov.uk/company/00445790',
      );
    }
    // Each flag points at the section that evidences it, not just the overview.
    const accounts = verdict.flags.find((flag) => flag.id === 'accounts-overdue');
    expect(accounts?.sourceUrl).toContain('/filing-history');
    const charges = verdict.flags.find((flag) => flag.id === 'charges-outstanding');
    expect(charges?.sourceUrl).toContain('/charges');
  });

  it('carries i18n keys rather than rendered English', () => {
    // A rendered string here would language-stamp anything cached and bypass
    // the translation layer with the most visible text in the product.
    const verdict = evaluateSnapshot(
      snapshot({ accounts: { overdue: true, hasEverFiled: true } }),
      NOW,
    );
    const flag = verdict.flags[0]!;
    expect(flag.labelKey).toBe('flag.accounts-overdue.label');
    expect(flag.detailKey).toBe('flag.accounts-overdue.detail');
    expect(flag.learnMoreUrl).toContain('utm_source=extension');
  });
});

describe('status-terminal', () => {
  it('fires on every terminal status in the Companies House enumeration', () => {
    for (const status of [
      'dissolved',
      'liquidation',
      'receivership',
      'administration',
      'voluntary-arrangement',
      'insolvency-proceedings',
      'converted-closed',
      'closed',
      'removed',
    ]) {
      expect(idsOf(evaluateSnapshot(snapshot({ status }), NOW))).toContain('status-terminal');
    }
  });

  it('does not fire on an active company', () => {
    expect(idsOf(evaluateSnapshot(snapshot({ status: 'active' }), NOW))).not.toContain(
      'status-terminal',
    );
  });

  it('does not fire on overseas entity statuses, which are not terminal', () => {
    for (const status of ['registered', 'open']) {
      expect(idsOf(evaluateSnapshot(snapshot({ status }), NOW))).not.toContain('status-terminal');
    }
  });
});

describe('strike-off', () => {
  it('fires while the company is still nominally active', () => {
    // The status field alone says "active". Anyone extending credit needs to
    // know the company is weeks from being struck off.
    const verdict = evaluateSnapshot(
      snapshot({ status: 'active', statusDetail: 'active-proposal-to-strike-off' }),
      NOW,
    );
    expect(idsOf(verdict)).toContain('strike-off');
    expect(verdict.overall).toBe('red');
  });

  it('does not fire on other status details', () => {
    expect(
      idsOf(evaluateSnapshot(snapshot({ statusDetail: 'transferred-from-uk' }), NOW)),
    ).not.toContain('strike-off');
  });
});

describe('accounts-overdue and cs-overdue', () => {
  it('reports overdue accounts as red and an overdue statement as amber', () => {
    expect(
      evaluateSnapshot(snapshot({ accounts: { overdue: true, hasEverFiled: true } }), NOW).overall,
    ).toBe('red');
    expect(
      evaluateSnapshot(snapshot({ confirmationStatement: { overdue: true } }), NOW).overall,
    ).toBe('amber');
  });

  it('carries the due date when the register gives one', () => {
    const verdict = evaluateSnapshot(
      snapshot({ accounts: { overdue: true, hasEverFiled: true, nextDue: '2026-01-31' } }),
      NOW,
    );
    expect(verdict.flags[0]?.params).toEqual({ dueDate: '2026-01-31' });
  });

  it('still fires without a due date rather than staying silent', () => {
    const verdict = evaluateSnapshot(
      snapshot({ accounts: { overdue: true, hasEverFiled: true } }),
      NOW,
    );
    expect(idsOf(verdict)).toContain('accounts-overdue');
    expect(verdict.flags[0]?.params).toBeUndefined();
  });
});

describe('young-no-accounts', () => {
  it('fires for a company under twelve months old that has filed nothing', () => {
    const verdict = evaluateSnapshot(
      snapshot({ incorporatedOn: '2026-02-16', accounts: { overdue: false, hasEverFiled: false } }),
      NOW,
    );
    expect(idsOf(verdict)).toContain('young-no-accounts');
  });

  it('holds the twelve-month boundary exactly', () => {
    const noAccounts = { overdue: false, hasEverFiled: false };
    // 30 July 2025 is under twelve months before 29 July 2026; the 29th is not.
    expect(
      idsOf(
        evaluateSnapshot(snapshot({ incorporatedOn: '2025-07-30', accounts: noAccounts }), NOW),
      ),
    ).toContain('young-no-accounts');
    expect(
      idsOf(
        evaluateSnapshot(snapshot({ incorporatedOn: '2025-07-29', accounts: noAccounts }), NOW),
      ),
    ).not.toContain('young-no-accounts');
  });

  it('does not fire once accounts have been filed, however young the company', () => {
    expect(
      idsOf(
        evaluateSnapshot(
          snapshot({
            incorporatedOn: '2026-02-16',
            accounts: { overdue: false, hasEverFiled: true },
          }),
          NOW,
        ),
      ),
    ).not.toContain('young-no-accounts');
  });

  it('reports not-checked when the register gives no incorporation date', () => {
    // Answering "not young" would be a guess dressed as a finding.
    const { incorporatedOn: _omitted, ...withoutDate } = snapshot({
      accounts: { overdue: false, hasEverFiled: false },
    });
    const verdict = evaluateSnapshot(withoutDate, NOW);
    expect(verdict.notChecked).toContain('young-no-accounts');
    expect(idsOf(verdict)).not.toContain('young-no-accounts');
    expect(verdict.partial).toBe(true);
  });
});

describe('officer-churn', () => {
  const officers = (resignedLast6m: number, activeCount: number) => ({
    officers: { activeCount, resignedCount: resignedLast6m, appointedLast6m: 0, resignedLast6m },
  });

  it('fires on two or more resignations in six months', () => {
    expect(idsOf(evaluateSnapshot(snapshot(officers(2, 4)), NOW))).toContain('officer-churn');
    expect(idsOf(evaluateSnapshot(snapshot(officers(1, 4)), NOW))).not.toContain('officer-churn');
  });

  it('also fires on a single resignation that leaves one director or none', () => {
    // The smaller, easily-missed case: a two-director company down to one.
    expect(idsOf(evaluateSnapshot(snapshot(officers(1, 1)), NOW))).toContain('officer-churn');
    expect(idsOf(evaluateSnapshot(snapshot(officers(1, 0)), NOW))).toContain('officer-churn');
    expect(idsOf(evaluateSnapshot(snapshot(officers(0, 1)), NOW))).not.toContain('officer-churn');
  });

  it('reports the count so the message can be specific', () => {
    const verdict = evaluateSnapshot(snapshot(officers(3, 5)), NOW);
    expect(verdict.flags.find((flag) => flag.id === 'officer-churn')?.params).toEqual({ count: 3 });
  });
});

describe('recent-move-young', () => {
  const young = { incorporatedOn: '2025-06-01' };
  const old = { incorporatedOn: '2005-04-01' };

  it('needs both limbs: a recent move and a young company', () => {
    expect(
      idsOf(evaluateSnapshot(snapshot({ ...young, registeredOfficeChangedOn: '2026-06-30' }), NOW)),
    ).toContain('recent-move-young');

    // Old company, recent move — unremarkable.
    expect(
      idsOf(evaluateSnapshot(snapshot({ ...old, registeredOfficeChangedOn: '2026-06-30' }), NOW)),
    ).not.toContain('recent-move-young');

    // Young company, old move — also unremarkable.
    expect(
      idsOf(evaluateSnapshot(snapshot({ ...young, registeredOfficeChangedOn: '2025-06-05' }), NOW)),
    ).not.toContain('recent-move-young');
  });

  it('holds the three-month boundary', () => {
    expect(
      idsOf(evaluateSnapshot(snapshot({ ...young, registeredOfficeChangedOn: '2026-04-30' }), NOW)),
    ).toContain('recent-move-young');
    expect(
      idsOf(evaluateSnapshot(snapshot({ ...young, registeredOfficeChangedOn: '2026-04-29' }), NOW)),
    ).not.toContain('recent-move-young');
  });

  it('holds the twenty-four-month boundary', () => {
    expect(
      idsOf(
        evaluateSnapshot(
          snapshot({ incorporatedOn: '2024-07-30', registeredOfficeChangedOn: '2026-06-30' }),
          NOW,
        ),
      ),
    ).toContain('recent-move-young');
    expect(
      idsOf(
        evaluateSnapshot(
          snapshot({ incorporatedOn: '2024-07-29', registeredOfficeChangedOn: '2026-06-30' }),
          NOW,
        ),
      ),
    ).not.toContain('recent-move-young');
  });

  it('is not-checked when filing history was not fetched', () => {
    const verdict = evaluateSnapshot(snapshot(young, { filings: 'failed' }), NOW);
    expect(verdict.notChecked).toContain('recent-move-young');
  });
});

describe('name-change', () => {
  it('fires on a rename inside twelve months and names the old company', () => {
    const verdict = evaluateSnapshot(
      snapshot({
        nameChangedOn: '2026-02-14',
        previousNames: [{ name: 'BRIGHT FUTURE TRADING LIMITED', ceasedOn: '2026-02-14' }],
      }),
      NOW,
    );
    const flag = verdict.flags.find((f) => f.id === 'name-change');
    expect(flag?.params).toEqual({
      changedOn: '2026-02-14',
      previousName: 'BRIGHT FUTURE TRADING LIMITED',
    });
  });

  it('does not fire on an older rename', () => {
    expect(idsOf(evaluateSnapshot(snapshot({ nameChangedOn: '2021-03-08' }), NOW))).not.toContain(
      'name-change',
    );
  });
});

describe('charges-outstanding', () => {
  it('is information and never lifts the pill', () => {
    // A charge is a lender taking security, which happens on every commercial
    // loan. Treating it as concerning would mark most healthy companies.
    const verdict = evaluateSnapshot(
      snapshot({ charges: { outstanding: 3, satisfied: 1, partSatisfied: 0 } }),
      NOW,
    );
    expect(idsOf(verdict)).toContain('charges-outstanding');
    expect(verdict.flags.find((f) => f.id === 'charges-outstanding')?.level).toBe('info');
    expect(verdict.overall).toBe('green');
  });

  it('does not prevent the all-clear', () => {
    const verdict = evaluateSnapshot(
      snapshot({ charges: { outstanding: 2, satisfied: 0, partSatisfied: 0 } }),
      NOW,
    );
    expect(idsOf(verdict)).toContain('all-clear');
  });
});

describe('all-clear', () => {
  it('fires for a long-established active company with nothing against it', () => {
    const verdict = evaluateSnapshot(snapshot(), NOW);
    expect(idsOf(verdict)).toContain('all-clear');
    expect(verdict.overall).toBe('green');
    expect(verdict.flags.find((f) => f.id === 'all-clear')?.params).toEqual({
      established: 'established',
    });
  });

  it('qualifies itself for a company under three years old', () => {
    // The register simply has less to say about a young company, so the
    // all-clear is qualified rather than withheld.
    const verdict = evaluateSnapshot(snapshot({ incorporatedOn: '2024-06-01' }), NOW);
    expect(verdict.flags.find((f) => f.id === 'all-clear')?.params).toEqual({
      established: 'young',
    });
  });

  it('does not fire when any concerning flag was raised', () => {
    for (const override of [
      { confirmationStatement: { overdue: true } },
      { accounts: { overdue: true, hasEverFiled: true } },
      { status: 'liquidation' },
    ]) {
      expect(idsOf(evaluateSnapshot(snapshot(override), NOW))).not.toContain('all-clear');
    }
  });

  it('does not fire for a company that is not active', () => {
    expect(idsOf(evaluateSnapshot(snapshot({ status: 'dissolved' }), NOW))).not.toContain(
      'all-clear',
    );
  });
});

describe('absence of evidence never becomes evidence of absence', () => {
  // The single most important property of this engine.

  it('reports not-checked, never clear, when a source failed', () => {
    const verdict = evaluateSnapshot(snapshot({}, { officers: 'failed' }), NOW);

    const officerChurn = verdict.evaluations.find(
      (evaluation) => evaluation.status !== 'raised' && evaluation.id === 'officer-churn',
    );
    expect(officerChurn?.status).toBe('not-checked');
    expect(verdict.notChecked).toContain('officer-churn');
    expect(verdict.partial).toBe(true);
  });

  it('withholds the all-clear whenever anything went unchecked', () => {
    // "No red flags in the public record" is a claim about the whole record.
    // It must not be made on the strength of a partial one.
    for (const failed of ['officers', 'charges', 'filings'] as const) {
      const verdict = evaluateSnapshot(snapshot({}, { [failed]: 'failed' }), NOW);
      expect(idsOf(verdict)).not.toContain('all-clear');
      expect(verdict.notChecked).toContain('all-clear');
    }
  });

  it('treats a skipped source exactly like a failed one', () => {
    // The Worker sheds depth in brownout to stay inside the rate limit. The
    // reader is no better informed for the reason being a good one.
    const verdict = evaluateSnapshot(snapshot({}, { charges: 'skipped' }), NOW);
    expect(verdict.notChecked).toContain('charges-outstanding');
    expect(idsOf(verdict)).not.toContain('all-clear');
  });

  it('treats not-applicable as an answer, not a gap', () => {
    // "This company has no charges" is a fact. Marking it unchecked would train
    // users to ignore the partial badge.
    const verdict = evaluateSnapshot(snapshot({}, { charges: 'not-applicable' }), NOW);
    expect(verdict.notChecked).not.toContain('charges-outstanding');
    expect(idsOf(verdict)).toContain('all-clear');
    expect(verdict.partial).toBe(false);
  });

  it('still raises the flags it could evaluate', () => {
    // Degrading to silence would be its own kind of dishonesty.
    const verdict = evaluateSnapshot(
      snapshot({ accounts: { overdue: true, hasEverFiled: true } }, { officers: 'failed' }),
      NOW,
    );
    expect(idsOf(verdict)).toContain('accounts-overdue');
    expect(verdict.overall).toBe('red');
    expect(verdict.partial).toBe(true);
  });

  it('names which sources were missing, so the panel can say what it skipped', () => {
    const verdict = evaluateSnapshot(snapshot({}, { officers: 'failed' }), NOW);
    const detail = notCheckedDetail(verdict).find((entry) => entry.id === 'officer-churn');
    expect(detail?.missing).toEqual(['officers']);
  });
});

describe('the summary pill', () => {
  it('takes the most severe flag raised', () => {
    const flag = (level: FlagLevel): Flag => ({
      id: 'accounts-overdue',
      level,
      labelKey: 'x',
      sourceUrl: 'https://example.invalid',
    });

    expect(overallSeverity([])).toBe('green');
    // `info` is shown but never lifts the pill.
    expect(overallSeverity([flag('info')])).toBe('green');
    expect(overallSeverity([flag('amber')])).toBe('amber');
    expect(overallSeverity([flag('amber'), flag('red')])).toBe('red');
  });

  it('orders flags red, then amber, then info, then green', () => {
    const verdict = evaluateSnapshot(
      snapshot({
        status: 'liquidation',
        accounts: { overdue: true, hasEverFiled: true },
        confirmationStatement: { overdue: true },
        charges: { outstanding: 1, satisfied: 0, partSatisfied: 0 },
      }),
      NOW,
    );
    const levels = verdict.flags.map((flag) => flag.level);
    expect(levels).toEqual([...levels].sort((a, b) => (a === b ? 0 : a === 'red' ? -1 : 1)));
    expect(levels[0]).toBe('red');
    expect(levels[levels.length - 1]).toBe('info');
  });
});
