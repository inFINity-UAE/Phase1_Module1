import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { AccountingPeriodsService } from './accounting-periods.service';
import { CreateAccountingPeriodDto } from './dto/create-accounting-period.dto';
import { UpdateAccountingPeriodDto } from './dto/update-accounting-period.dto';
import { SoftCloseAccountingPeriodDto } from './dto/soft-close-accounting-period.dto';

/**
 * [feature-spec.md decisions #10/#11] Every route requires an authenticated
 * session. soft_closed_by / closed_by / reopened_by are never taken from the
 * body — soft-close uses @CurrentUser().id. Hard-close and reopen HTTP
 * endpoints are not built yet (schema columns reserved; reopen_* is only
 * written via journal post soft-closed override logging).
 */
@Controller('accounting-periods')
@UseGuards(SupabaseAuthGuard)
export class AccountingPeriodsController {
  constructor(private readonly accountingPeriodsService: AccountingPeriodsService) {}

  @Post()
  create(@Body() dto: CreateAccountingPeriodDto) {
    return this.accountingPeriodsService.create(dto);
  }

  @Get()
  findAll() {
    return this.accountingPeriodsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.accountingPeriodsService.findOne(id);
  }

  /**
   * [feature-spec.md decisions #10/#11] soft_closed_by is the authenticated
   * session user — never a client body field.
   */
  @Post(':id/soft-close')
  softClose(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() _dto: SoftCloseAccountingPeriodDto,
  ) {
    return this.accountingPeriodsService.softClose(id, user.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountingPeriodDto,
  ) {
    return this.accountingPeriodsService.update(id, dto);
  }
}
