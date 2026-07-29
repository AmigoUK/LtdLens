/**
 * Raw Companies House public data API responses.
 *
 * Every field is optional. That is not laziness — the API genuinely omits
 * fields (a company with no accounts filed has no `accounts.last_accounts`,
 * a dissolved company may lack half the profile), and the published schema
 * marks almost everything as optional too. Modelling that honestly forces the
 * normalisers to handle absence explicitly, which is exactly what we want:
 * a missing field must become "not known", never a silently wrong default.
 *
 * These types cover only what LtdLens reads. They are deliberately not a
 * complete transcription of the API.
 *
 * Schema reference: https://developer-specs.company-information.service.gov.uk/
 */

/** ISO 8601 date, `YYYY-MM-DD`, as Companies House returns it. */
export type ChDate = string;

/** https://developer-specs.company-information.service.gov.uk/.../companyprofile */
export interface ChCompanyProfile {
  company_name?: string;
  company_number?: string;
  company_status?: string;
  company_status_detail?: string;
  type?: string;
  jurisdiction?: string;
  date_of_creation?: ChDate;
  date_of_cessation?: ChDate;
  sic_codes?: string[];
  registered_office_address?: ChAddress;
  registered_office_is_in_dispute?: boolean;
  undeliverable_registered_office_address?: boolean;
  accounts?: ChAccounts;
  confirmation_statement?: ChConfirmationStatement;
  previous_company_names?: ChPreviousCompanyName[];
  /**
   * Deprecated by Companies House in favour of `links.charges` and
   * `links.insolvency`. Read the links instead; these are kept only so a
   * recorded fixture round-trips unchanged.
   */
  has_charges?: boolean;
  has_insolvency_history?: boolean;
  links?: ChCompanyLinks;
}

export interface ChAddress {
  premises?: string;
  address_line_1?: string;
  address_line_2?: string;
  care_of?: string;
  po_box?: string;
  locality?: string;
  region?: string;
  postal_code?: string;
  country?: string;
}

export interface ChAccounts {
  next_due?: ChDate;
  next_made_up_to?: ChDate;
  overdue?: boolean;
  last_accounts?: ChLastAccounts;
  next_accounts?: ChNextAccounts;
  accounting_reference_date?: { day?: number; month?: number };
}

export interface ChLastAccounts {
  /** Deprecated upstream in favour of `period_end_on`, but still returned. */
  made_up_to?: ChDate;
  period_start_on?: ChDate;
  period_end_on?: ChDate;
  type?: string;
}

export interface ChNextAccounts {
  due_on?: ChDate;
  overdue?: boolean;
  period_start_on?: ChDate;
  period_end_on?: ChDate;
}

export interface ChConfirmationStatement {
  next_due?: ChDate;
  next_made_up_to?: ChDate;
  last_made_up_to?: ChDate;
  overdue?: boolean;
}

export interface ChPreviousCompanyName {
  name?: string;
  effective_from?: ChDate;
  ceased_on?: ChDate;
}

export interface ChCompanyLinks {
  self?: string;
  charges?: string;
  filing_history?: string;
  insolvency?: string;
  officers?: string;
  persons_with_significant_control?: string;
  registers?: string;
}

/** https://developer-specs.company-information.service.gov.uk/.../officerlist */
export interface ChOfficerList {
  active_count?: number;
  resigned_count?: number;
  total_results?: number;
  items_per_page?: number;
  start_index?: number;
  items?: ChOfficer[];
}

export interface ChOfficer {
  name?: string;
  officer_role?: string;
  appointed_on?: ChDate;
  resigned_on?: ChDate;
  nationality?: string;
  country_of_residence?: string;
  occupation?: string;
  date_of_birth?: { month?: number; year?: number };
  address?: ChAddress;
  /**
   * Added by the Economic Crime and Corporate Transparency Act rollout.
   * Identity verification became a legal requirement on 18 November 2025 with
   * a twelve-month transition, so an absent verification date is normal until
   * roughly mid-November 2026 and must not be treated as a risk signal.
   */
  identity_verification_details?: {
    identity_verified_on?: ChDate;
    appointment_verification_start_on?: ChDate;
    appointment_verification_end_on?: ChDate;
    appointment_verification_statement_due_on?: ChDate;
  };
}

/** https://developer-specs.company-information.service.gov.uk/.../chargelist */
export interface ChChargeList {
  total_count?: number;
  satisfied_count?: number;
  part_satisfied_count?: number;
  /**
   * Spelt this way by Companies House. The typo is in the published schema and
   * in live responses; do not "fix" it here or the field stops being read.
   */
  unfiletered_count?: number;
  items?: ChCharge[];
}

export interface ChCharge {
  charge_number?: number;
  /** `outstanding` | `fully-satisfied` | `part-satisfied` | `satisfied` */
  status?: string;
  created_on?: ChDate;
  delivered_on?: ChDate;
  satisfied_on?: ChDate;
  classification?: { type?: string; description?: string };
  persons_entitled?: { name?: string }[];
}

/** https://developer-specs.company-information.service.gov.uk/.../filinghistorylist */
export interface ChFilingHistoryList {
  total_count?: number;
  items_per_page?: number;
  start_index?: number;
  filing_history_status?: string;
  items?: ChFiling[];
}

export interface ChFiling {
  transaction_id?: string;
  /**
   * `accounts` | `address` | `annual-return` | `capital` | `change-of-name` |
   * `incorporation` | `liquidation` | `miscellaneous` | `mortgage` |
   * `officers` | `resolution`
   */
  category?: string;
  subcategory?: string;
  date?: ChDate;
  description?: string;
  /** Present in live responses although absent from the published schema. */
  description_values?: Record<string, string>;
  type?: string;
  paper_filed?: boolean;
  pages?: number;
}

/** https://developer-specs.company-information.service.gov.uk/.../companysearch */
export interface ChSearchResponse {
  total_results?: number;
  items_per_page?: number;
  start_index?: number;
  items?: ChSearchItem[];
}

export interface ChSearchItem {
  company_number?: string;
  title?: string;
  company_status?: string;
  company_type?: string;
  date_of_creation?: ChDate;
  date_of_cessation?: ChDate;
  address_snippet?: string;
  address?: ChAddress;
}
