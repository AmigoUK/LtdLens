import { describe, expect, it } from 'vitest';
import {
  companyRecordUrl,
  companySearchUrl,
  isCompanyNumber,
  normaliseCompanyNumber,
} from '../src/normalise/companyNumber.js';

describe('normaliseCompanyNumber', () => {
  it('pads the leading zeros people never type', () => {
    // Tesco PLC is 00445790, but nobody pastes it that way from an invoice.
    expect(normaliseCompanyNumber('445790')).toBe('00445790');
    expect(normaliseCompanyNumber('00445790')).toBe('00445790');
    expect(normaliseCompanyNumber('1')).toBe('00000001');
  });

  it('keeps eight-digit numbers unchanged', () => {
    expect(normaliseCompanyNumber('12345678')).toBe('12345678');
    expect(normaliseCompanyNumber('14990998')).toBe('14990998');
  });

  it('handles the two-letter register prefixes', () => {
    expect(normaliseCompanyNumber('SC123456')).toBe('SC123456');
    expect(normaliseCompanyNumber('SC1234')).toBe('SC001234');
    expect(normaliseCompanyNumber('NI012345')).toBe('NI012345');
    expect(normaliseCompanyNumber('OC301234')).toBe('OC301234');
    expect(normaliseCompanyNumber('SO305678')).toBe('SO305678');
    expect(normaliseCompanyNumber('FC012345')).toBe('FC012345');
    expect(normaliseCompanyNumber('OE123456')).toBe('OE123456');
    expect(normaliseCompanyNumber('LP003456')).toBe('LP003456');
  });

  it('handles historic Northern Irish numbers', () => {
    expect(normaliseCompanyNumber('R0000123')).toBe('R0000123');
    expect(normaliseCompanyNumber('R123')).toBe('R0000123');
  });

  it('tolerates the ways a number arrives from a page', () => {
    expect(normaliseCompanyNumber('sc123456')).toBe('SC123456');
    expect(normaliseCompanyNumber('  00445790  ')).toBe('00445790');
    expect(normaliseCompanyNumber('004 457 90')).toBe('00445790');
    expect(normaliseCompanyNumber('SC-123456')).toBe('SC123456');
  });

  it('rejects unknown prefixes rather than inventing a register', () => {
    expect(normaliseCompanyNumber('XX123456')).toBeUndefined();
    expect(normaliseCompanyNumber('AB123456')).toBeUndefined();
  });

  it('rejects anything that cannot be a company number', () => {
    expect(normaliseCompanyNumber(undefined)).toBeUndefined();
    expect(normaliseCompanyNumber(null)).toBeUndefined();
    expect(normaliseCompanyNumber('')).toBeUndefined();
    expect(normaliseCompanyNumber('   ')).toBeUndefined();
    expect(normaliseCompanyNumber('123456789')).toBeUndefined(); // too long
    expect(normaliseCompanyNumber('SC1234567')).toBeUndefined(); // too long
    expect(normaliseCompanyNumber('ACME LTD')).toBeUndefined();
    expect(normaliseCompanyNumber('GB123456789')).toBeUndefined(); // a VAT number
  });

  it('does not mistake a VAT number for a company number', () => {
    // VAT registration numbers are nine digits, sometimes with a GB prefix.
    // Both are longer than eight characters, so both are rejected.
    expect(normaliseCompanyNumber('123456789')).toBeUndefined();
    expect(normaliseCompanyNumber('GB 123 4567 89')).toBeUndefined();
  });
});

describe('isCompanyNumber', () => {
  it('accepts only the canonical form', () => {
    expect(isCompanyNumber('00445790')).toBe(true);
    expect(isCompanyNumber('SC123456')).toBe(true);
    expect(isCompanyNumber('445790')).toBe(false); // valid input, not canonical
    expect(isCompanyNumber('sc123456')).toBe(false);
  });
});

describe('companyRecordUrl', () => {
  it('builds the public Companies House record URL', () => {
    expect(companyRecordUrl('00445790')).toBe(
      'https://find-and-update.company-information.service.gov.uk/company/00445790',
    );
  });

  it('normalises on the way in, so a flag never links to a 404', () => {
    expect(companyRecordUrl('445790')).toBe(
      'https://find-and-update.company-information.service.gov.uk/company/00445790',
    );
  });

  it('links to the specific section that proves a flag', () => {
    expect(companyRecordUrl('00445790', 'filing-history')).toBe(
      'https://find-and-update.company-information.service.gov.uk/company/00445790/filing-history',
    );
    expect(companyRecordUrl('00445790', 'officers')).toContain('/00445790/officers');
    expect(companyRecordUrl('00445790', 'charges')).toContain('/00445790/charges');
  });

  it('passes through anything it cannot normalise rather than dropping the link', () => {
    expect(companyRecordUrl('NOT-A-NUMBER')).toContain('/company/NOT-A-NUMBER');
  });
});

describe('companySearchUrl', () => {
  it('escapes the query', () => {
    expect(companySearchUrl('acme trading & co')).toBe(
      'https://find-and-update.company-information.service.gov.uk/search/companies?q=acme%20trading%20%26%20co',
    );
  });

  it('escapes characters that would otherwise break the query string', () => {
    expect(companySearchUrl('a?b#c=d')).toContain('?q=a%3Fb%23c%3Dd');
  });
});
