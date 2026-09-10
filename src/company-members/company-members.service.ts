import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CompanyRole } from '../common/enums/company-role.enum';
import {
  COMPANY_MEMBERS_REPOSITORY,
  CompanyMembersRepository,
  CompanyResourceKind,
} from './company-members.repository';

@Injectable()
export class CompanyMembersService {
  constructor(
    @Inject(COMPANY_MEMBERS_REPOSITORY)
    private readonly companyMembersRepository: CompanyMembersRepository,
  ) {}

  /**
   * [company_members.sql §11] [feature-spec.md decision #41] Resolve a user's
   * role for a company from DB membership. Throws 403 when no row exists —
   * never accept role from the request body; never use 404 for non-membership
   * (do not conflate with missing resources).
   */
  async resolveRole(userId: string, companyId: string): Promise<CompanyRole> {
    const role = await this.companyMembersRepository.findRole(userId, companyId);
    if (!role) {
      throw new ForbiddenException('User is not a member of this company');
    }
    return role;
  }

  /** [feature-spec-1_1_D.md §4.5a] Scheduled ECL posts as company Owner. */
  async findOwnerUserId(companyId: string): Promise<string | null> {
    return this.companyMembersRepository.findOwnerUserId(companyId);
  }

  /**
   * Entry-scoped actions: look up the target entry's company_id first, then
   * resolve membership. Prefer CompanyMembershipGuard for HTTP; this remains
   * for service-layer callers (unit tests / internal) that need both fields.
   */
  async resolveRoleForJournalEntry(
    userId: string,
    entryId: string,
  ): Promise<{ companyId: string; role: CompanyRole }> {
    const companyId = await this.resolveCompanyIdForResource('journal_entry', entryId);
    const role = await this.resolveRole(userId, companyId);
    return { companyId, role };
  }

  /**
   * [feature-spec.md decision #41] Map a parent resource id → company_id.
   * Missing resource → 404. Does not check membership (caller must).
   */
  async resolveCompanyIdForResource(
    resource: CompanyResourceKind,
    resourceId: string,
  ): Promise<string> {
    let companyId: string | null;
    switch (resource) {
      case 'journal_entry':
        companyId =
          await this.companyMembersRepository.findCompanyIdByJournalEntryId(resourceId);
        break;
      case 'journal_line':
        companyId =
          await this.companyMembersRepository.findCompanyIdByJournalLineId(resourceId);
        break;
      case 'account':
        companyId = await this.companyMembersRepository.findCompanyIdByAccountId(resourceId);
        break;
      case 'accounting_period':
        companyId =
          await this.companyMembersRepository.findCompanyIdByAccountingPeriodId(resourceId);
        break;
      case 'recurring_template':
        companyId =
          await this.companyMembersRepository.findCompanyIdByRecurringTemplateId(resourceId);
        break;
      case 'recurring_template_line':
        companyId =
          await this.companyMembersRepository.findCompanyIdByRecurringTemplateLineId(
            resourceId,
          );
        break;
      case 'customer':
        companyId = await this.companyMembersRepository.findCompanyIdByCustomerId(resourceId);
        break;
      case 'quotation':
        companyId = await this.companyMembersRepository.findCompanyIdByQuotationId(resourceId);
        break;
      case 'quotation_line':
        companyId =
          await this.companyMembersRepository.findCompanyIdByQuotationLineId(resourceId);
        break;
      case 'invoice':
        companyId = await this.companyMembersRepository.findCompanyIdByInvoiceId(resourceId);
        break;
      case 'invoice_line':
        companyId =
          await this.companyMembersRepository.findCompanyIdByInvoiceLineId(resourceId);
        break;
      case 'credit_note':
        companyId =
          await this.companyMembersRepository.findCompanyIdByCreditNoteId(resourceId);
        break;
      case 'credit_note_line':
        companyId =
          await this.companyMembersRepository.findCompanyIdByCreditNoteLineId(resourceId);
        break;
      case 'payment':
        companyId = await this.companyMembersRepository.findCompanyIdByPaymentId(resourceId);
        break;
      case 'payment_application':
        companyId =
          await this.companyMembersRepository.findCompanyIdByPaymentApplicationId(resourceId);
        break;
      case 'public_holiday':
        companyId =
          await this.companyMembersRepository.findCompanyIdByPublicHolidayId(resourceId);
        break;
      default: {
        const _exhaustive: never = resource;
        throw new NotFoundException(`Unknown resource kind ${_exhaustive}`);
      }
    }

    if (!companyId) {
      throw new NotFoundException(`${resource} ${resourceId} not found`);
    }
    return companyId;
  }
}
