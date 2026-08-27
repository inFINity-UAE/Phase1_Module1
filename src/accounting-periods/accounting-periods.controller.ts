import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { AccountingPeriodsService } from './accounting-periods.service';
import { CreateAccountingPeriodDto } from './dto/create-accounting-period.dto';
import { UpdateAccountingPeriodDto } from './dto/update-accounting-period.dto';
import { SoftCloseAccountingPeriodDto } from './dto/soft-close-accounting-period.dto';

/**
 * [feature-spec.md decisions #10/#11/#21/#30/#41] Session + membership on every
 * route. soft_closed_by from @CurrentUser().id — never body.
 */
@Controller('accounting-periods')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class AccountingPeriodsController {
  constructor(private readonly accountingPeriodsService: AccountingPeriodsService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateAccountingPeriodDto) {
    return this.accountingPeriodsService.create(dto);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.accountingPeriodsService.findAll(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'accounting_period' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.accountingPeriodsService.findOne(id);
  }

  /**
   * [feature-spec.md decisions #10/#11/#41] soft_closed_by from session;
   * membership from period row.
   */
  @Post(':id/soft-close')
  @RequireCompanyMembership({ type: 'param', resource: 'accounting_period' })
  softClose(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() _dto: SoftCloseAccountingPeriodDto,
  ) {
    return this.accountingPeriodsService.softClose(id, user.id);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'accounting_period' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountingPeriodDto,
  ) {
    return this.accountingPeriodsService.update(id, dto);
  }
}
