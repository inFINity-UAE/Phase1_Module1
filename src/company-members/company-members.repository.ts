import { CompanyRole } from '../common/enums/company-role.enum';

export const COMPANY_MEMBERS_REPOSITORY = Symbol('COMPANY_MEMBERS_REPOSITORY');

export interface CompanyMembersRepository {
  findRole(userId: string, companyId: string): Promise<CompanyRole | null>;
  findCompanyIdByJournalEntryId(entryId: string): Promise<string | null>;
}
