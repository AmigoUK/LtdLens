/**
 * UK company numbers.
 *
 * A company number is always eight characters. Most are eight digits, but
 * several registers use a two-letter prefix followed by six digits — `SC` for
 * Scotland, `NI` for Northern Ireland, `OC`/`SO`/`NC` for limited liability
 * partnerships, `FC` for overseas companies, `OE` for overseas entities, and
 * others. Historic Northern Irish numbers take a single `R` and seven digits.
 *
 * People rarely type the leading zeros. Tesco is `00445790`, but it will be
 * pasted as `445790` from an invoice, a spreadsheet or somebody's memory, so
 * normalising means padding to the register's own width rather than rejecting
 * what a human would consider the same number.
 */

/** Two-letter prefixes Companies House issues. */
const PREFIXES = [
  'AC', // assurance company
  'CE', // charitable incorporated organisation (England & Wales)
  'CS', // charitable incorporated organisation (Scotland)
  'FC', // overseas company
  'FE', // further education / sixth form college
  'GE', // European economic interest grouping
  'GN', // ditto, Northern Ireland
  'GS', // ditto, Scotland
  'IC', // investment company with variable capital
  'IP', // industrial and provident society
  'LP', // limited partnership
  'NA', // Northern Ireland assurance
  'NC', // LLP, Northern Ireland
  'NF', // overseas company, Northern Ireland
  'NI', // Northern Ireland
  'NL', // limited partnership, Northern Ireland
  'NO', // Northern Ireland credit union / industrial & provident
  'NP', // Northern Ireland industrial & provident
  'NR', // Northern Ireland registered society
  'NV', // Northern Ireland
  'NZ', // Northern Ireland
  'OC', // LLP, England & Wales
  'OE', // overseas entity
  'PC', // protected cell company
  'RC', // royal charter
  'RS', // registered society (Scotland)
  'SA', // Scottish assurance
  'SC', // Scotland
  'SF', // overseas company, Scotland
  'SG', // Scotland
  'SI', // Scottish investment company with variable capital
  'SL', // Scottish limited partnership
  'SO', // LLP, Scotland
  'SP', // Scottish industrial & provident
  'SR', // Scottish registered society
  'SZ', // Scotland
  'ZC', // unregistered company
] as const;

const PREFIX_SET: ReadonlySet<string> = new Set(PREFIXES);

const ALL_DIGITS = /^\d{1,8}$/;
const PREFIXED = /^([A-Z]{2})(\d{1,6})$/;
const HISTORIC_NI = /^R(\d{1,7})$/;

/**
 * Normalises to canonical eight-character form, or returns undefined if the
 * input cannot be a company number. Tolerates lower case, surrounding
 * whitespace, internal spaces, and the hyphens people insert when reading a
 * number aloud.
 */
export function normaliseCompanyNumber(raw: string | undefined | null): string | undefined {
  if (typeof raw !== 'string') return undefined;

  const cleaned = raw.replace(/[\s -]/g, '').toUpperCase();
  if (cleaned.length === 0 || cleaned.length > 8) return undefined;

  if (ALL_DIGITS.test(cleaned)) return cleaned.padStart(8, '0');

  const historic = HISTORIC_NI.exec(cleaned);
  if (historic) return `R${historic[1]!.padStart(7, '0')}`;

  const prefixed = PREFIXED.exec(cleaned);
  if (prefixed) {
    const prefix = prefixed[1]!;
    if (!PREFIX_SET.has(prefix)) return undefined;
    return `${prefix}${prefixed[2]!.padStart(6, '0')}`;
  }

  return undefined;
}

/** True if the value is already a canonical eight-character company number. */
export function isCompanyNumber(value: string): boolean {
  return normaliseCompanyNumber(value) === value;
}

/**
 * The public Companies House record for a company. Used for every `sourceUrl`
 * on every flag, and as the fallback when the lookup service is unavailable —
 * a user must always be one click from the official record.
 */
export function companyRecordUrl(number: string, section?: string): string {
  const normalised = normaliseCompanyNumber(number) ?? number;
  const base = `https://find-and-update.company-information.service.gov.uk/company/${normalised}`;
  return section === undefined ? base : `${base}/${section}`;
}

/**
 * The Companies House search page for a free-text query.
 *
 * Built by hand rather than with `URL`, which would require pulling the DOM lib
 * into this package and handing pure logic the `window` and `document` types it
 * is forbidden to use.
 */
export function companySearchUrl(query: string): string {
  const base = 'https://find-and-update.company-information.service.gov.uk/search/companies';
  return `${base}?q=${encodeURIComponent(query)}`;
}
