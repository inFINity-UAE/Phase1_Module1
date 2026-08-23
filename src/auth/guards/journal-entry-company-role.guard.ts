import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../authenticated-user';
import { CompanyMembersService } from '../../company-members/company-members.service';

/**
 * [company_members.sql §11] Resolves the caller's company role from DB membership
 * for journal-entry-scoped routes (`:id/post`, `:id/approve`, `:id/reject`).
 * Requires SupabaseAuthGuard to run first. Attaches role to request.user.role.
 */
@Injectable()
export class JournalEntryCompanyRoleGuard implements CanActivate {
  constructor(private readonly companyMembersService: CompanyMembersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params: { id?: string };
      user?: AuthenticatedUser;
    }>();

    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    const entryId = request.params.id;
    if (!entryId) {
      throw new NotFoundException('Journal entry id is required');
    }

    const { role } = await this.companyMembersService.resolveRoleForJournalEntry(
      userId,
      entryId,
    );

    request.user = { id: userId, role };
    return true;
  }
}
