import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { VatService } from './vat.service';

/** [feature-spec-1_1_F.md F-4] */
@Controller('vat-apportionment')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class VatApportionmentController {
  constructor(private readonly vatService: VatService) {}

  @Post(':vatReturnId/calculate')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_return_period', param: 'vatReturnId' })
  calculate(
    @Param('vatReturnId', ParseUUIDPipe) vatReturnId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vatService.calculateApportionment(vatReturnId, user.id);
  }
}
