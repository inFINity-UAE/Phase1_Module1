import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CompanyMembersService } from '../../company-members/company-members.service';
import { AuthenticatedUser } from '../authenticated-user';
import {
  CompanyMembershipSource,
  REQUIRE_COMPANY_MEMBERSHIP_KEY,
} from '../decorators/require-company-membership.decorator';

type HttpRequest = {
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  user?: AuthenticatedUser;
};

/**
 * [feature-spec.md decision #41] Shared tenant gate for every route that
 * resolves to a company_id. Reuses CompanyMembersService.resolveRole (same
 * lookup as post/approve/reject). Attaches role to request.user so role
 * checks do not re-query. Fail-closed if a handler omits @RequireCompanyMembership.
 */
@Injectable()
export class CompanyMembershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly companyMembersService: CompanyMembersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const source = this.reflector.getAllAndOverride<CompanyMembershipSource | undefined>(
      REQUIRE_COMPANY_MEMBERSHIP_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!source) {
      throw new InternalServerErrorException(
        'Company membership metadata missing — every authenticated route must declare @RequireCompanyMembership',
      );
    }

    const request = context.switchToHttp().getRequest<HttpRequest>();
    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    const companyId = await this.resolveCompanyId(source, request);
    const role = await this.companyMembersService.resolveRole(userId, companyId);

    request.user = { id: userId, role };
    return true;
  }

  private async resolveCompanyId(
    source: CompanyMembershipSource,
    request: HttpRequest,
  ): Promise<string> {
    switch (source.type) {
      case 'body': {
        const field = source.field ?? 'company_id';
        const value = request.body?.[field];
        if (typeof value !== 'string' || !value) {
          throw new BadRequestException(`${field} is required`);
        }
        return value;
      }
      case 'query': {
        const field = source.field ?? 'company_id';
        const value = request.query?.[field];
        if (typeof value !== 'string' || !value) {
          throw new BadRequestException(`${field} query parameter is required`);
        }
        return value;
      }
      case 'body_ref': {
        const field = source.field ?? 'journal_entry_id';
        const refId = request.body?.[field];
        if (typeof refId !== 'string' || !refId) {
          throw new BadRequestException(`${field} is required`);
        }
        return this.companyMembersService.resolveCompanyIdForResource(
          source.resource,
          refId,
        );
      }
      case 'param': {
        const param = source.param ?? 'id';
        const resourceId = request.params?.[param];
        if (!resourceId) {
          throw new NotFoundException(`${source.resource} id is required`);
        }
        return this.companyMembersService.resolveCompanyIdForResource(
          source.resource,
          resourceId,
        );
      }
      default: {
        const _exhaustive: never = source;
        throw new InternalServerErrorException(
          `Unknown company membership source: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  }
}
