import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

/**
 * [feature-spec.md decisions #24/#41] Session + company membership on every route.
 * List requires company_id (same bar as periods/journals).
 */
@Controller('accounts')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateAccountDto) {
    return this.accountsService.create(dto);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.accountsService.findAll(companyId);
  }

  /**
   * [feature-spec.md decision #47] Per-account slice of v_trial_balance
   * ([Rules §3.1]). Membership resolved from the account id (#41).
   */
  @Get(':id/trial-balance')
  @RequireCompanyMembership({ type: 'param', resource: 'account' })
  getTrialBalance(@Param('id', ParseUUIDPipe) id: string) {
    return this.accountsService.getTrialBalance(id);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'account' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.accountsService.findOne(id);
  }

  @Patch(':id/deactivate')
  @RequireCompanyMembership({ type: 'param', resource: 'account' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.accountsService.deactivate(id);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'account' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto) {
    return this.accountsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCompanyMembership({ type: 'param', resource: 'account' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.accountsService.remove(id);
  }
}
