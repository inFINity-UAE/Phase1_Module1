import { SetMetadata } from '@nestjs/common';

/** [feature-spec.md decision #41] Metadata key for CompanyMembershipGuard. */
export const REQUIRE_COMPANY_MEMBERSHIP_KEY = 'requireCompanyMembership';

/** How to resolve the target company_id for a route. */
export type CompanyMembershipSource =
  | { type: 'body'; field?: string }
  | { type: 'query'; field?: string }
  | {
      type: 'param';
      resource:
        | 'journal_entry'
        | 'journal_line'
        | 'account'
        | 'accounting_period'
        | 'recurring_template'
        | 'recurring_template_line'
        | 'customer'
        | 'quotation'
        | 'quotation_line'
        | 'invoice'
        | 'invoice_line'
        | 'credit_note'
        | 'credit_note_line'
        | 'payment'
        | 'payment_application'
        | 'public_holiday';
      param?: string;
    }
  | {
      type: 'body_ref';
      resource: 'journal_entry' | 'quotation' | 'invoice' | 'credit_note' | 'payment';
      field?: string;
    };

/**
 * [feature-spec.md decision #41] Mark a route so CompanyMembershipGuard
 * resolves company_id and verifies company_members before the handler.
 */
export const RequireCompanyMembership = (source: CompanyMembershipSource) =>
  SetMetadata(REQUIRE_COMPANY_MEMBERSHIP_KEY, source);
