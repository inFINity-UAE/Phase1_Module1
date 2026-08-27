import { CompanyRole } from '../common/enums/company-role.enum';

export const COMPANY_MEMBERS_REPOSITORY = Symbol('COMPANY_MEMBERS_REPOSITORY');

export type CompanyResourceKind =
  | 'journal_entry'
  | 'journal_line'
  | 'account'
  | 'accounting_period'
  | 'recurring_template'
  | 'recurring_template_line';

export interface CompanyMembersRepository {
  findRole(userId: string, companyId: string): Promise<CompanyRole | null>;
  findCompanyIdByJournalEntryId(entryId: string): Promise<string | null>;
  findCompanyIdByJournalLineId(lineId: string): Promise<string | null>;
  findCompanyIdByAccountId(accountId: string): Promise<string | null>;
  findCompanyIdByAccountingPeriodId(periodId: string): Promise<string | null>;
  findCompanyIdByRecurringTemplateId(templateId: string): Promise<string | null>;
  findCompanyIdByRecurringTemplateLineId(lineId: string): Promise<string | null>;
}
