import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CompanyRole } from '../common/enums/company-role.enum';
import {
  COMPANY_MEMBERS_REPOSITORY,
  CompanyMembersRepository,
} from './company-members.repository';

@Injectable()
export class CompanyMembersService {
  constructor(
    @Inject(COMPANY_MEMBERS_REPOSITORY)
    private readonly companyMembersRepository: CompanyMembersRepository,
  ) {}

  /**
   * [company_members.sql §11] Resolve a user's role for a company from DB membership.
   * Throws 403 when no row exists — never accept role from the request body.
   */
  async resolveRole(userId: string, companyId: string): Promise<CompanyRole> {
    const role = await this.companyMembersRepository.findRole(userId, companyId);
    if (!role) {
      throw new ForbiddenException('User is not a member of this company');
    }
    return role;
  }

  /**
   * Entry-scoped actions (post/approve/reject): look up the target entry's company_id
   * first, then resolve membership for (user_id, company_id).
   */
  async resolveRoleForJournalEntry(
    userId: string,
    entryId: string,
  ): Promise<{ companyId: string; role: CompanyRole }> {
    const companyId =
      await this.companyMembersRepository.findCompanyIdByJournalEntryId(entryId);
    if (!companyId) {
      throw new NotFoundException(`Journal entry ${entryId} not found`);
    }

    const role = await this.resolveRole(userId, companyId);
    return { companyId, role };
  }
}
