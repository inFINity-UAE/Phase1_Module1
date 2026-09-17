import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CreateBadDebtReliefClaimDto } from './dto/vat.dto';
import { VatService } from './vat.service';

/** [feature-spec-1_1_F.md F-6 / F-41] */
@Controller('bad-debt-relief-claims')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class BadDebtReliefClaimsController {
  constructor(private readonly vatService: VatService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateBadDebtReliefClaimDto, @CurrentUser() user: AuthenticatedUser) {
    return this.vatService.createClaim(dto, user.id);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.vatService.listClaims(companyId);
  }

  @Post(':id/claim')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_bad_debt_relief_claim' })
  claim(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vatService.claimRelief(id, user.id, user.role);
  }
}

/** [feature-spec-1_1_F.md F-12 / F-39] */
@Controller('vat-voluntary-disclosures')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class VatVoluntaryDisclosuresController {
  constructor(private readonly vatService: VatService) {}

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.vatService.listDisclosures(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_voluntary_disclosure' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.vatService.findDisclosure(id);
  }

  @Post(':id/approve')
  @RequireCompanyMembership({ type: 'param', resource: 'vat_voluntary_disclosure' })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vatService.approveDisclosure(id, user.id, user.role);
  }
}
