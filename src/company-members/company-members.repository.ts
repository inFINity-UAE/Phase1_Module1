import { CompanyRole } from '../common/enums/company-role.enum';

export const COMPANY_MEMBERS_REPOSITORY = Symbol('COMPANY_MEMBERS_REPOSITORY');

export type CompanyResourceKind =
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

export interface CompanyMembersRepository {
  findRole(userId: string, companyId: string): Promise<CompanyRole | null>;
  findOwnerUserId(companyId: string): Promise<string | null>;
  findCompanyIdByJournalEntryId(entryId: string): Promise<string | null>;
  findCompanyIdByJournalLineId(lineId: string): Promise<string | null>;
  findCompanyIdByAccountId(accountId: string): Promise<string | null>;
  findCompanyIdByAccountingPeriodId(periodId: string): Promise<string | null>;
  findCompanyIdByRecurringTemplateId(templateId: string): Promise<string | null>;
  findCompanyIdByRecurringTemplateLineId(lineId: string): Promise<string | null>;
  findCompanyIdByCustomerId(customerId: string): Promise<string | null>;
  findCompanyIdByQuotationId(quotationId: string): Promise<string | null>;
  findCompanyIdByQuotationLineId(lineId: string): Promise<string | null>;
  findCompanyIdByInvoiceId(invoiceId: string): Promise<string | null>;
  findCompanyIdByInvoiceLineId(lineId: string): Promise<string | null>;
  findCompanyIdByCreditNoteId(creditNoteId: string): Promise<string | null>;
  findCompanyIdByCreditNoteLineId(lineId: string): Promise<string | null>;
  findCompanyIdByPaymentId(paymentId: string): Promise<string | null>;
  findCompanyIdByPaymentApplicationId(applicationId: string): Promise<string | null>;
  findCompanyIdByPublicHolidayId(holidayId: string): Promise<string | null>;
}
