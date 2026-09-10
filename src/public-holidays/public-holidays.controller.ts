import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';
import { UpdatePublicHolidayDto } from './dto/update-public-holiday.dto';
import { PublicHolidaysService } from './public-holidays.service';

/**
 * [feature-spec-1_1_D.md §3.1b / D-14]
 * Company-scoped public-holiday admin; Owner/Accountant only.
 */
@Controller('public-holidays')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class PublicHolidaysController {
  constructor(private readonly publicHolidaysService: PublicHolidaysService) {}

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(
    @Query('company_id') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.publicHolidaysService.findAll(companyId, user.role);
  }

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreatePublicHolidayDto, @CurrentUser() user: AuthenticatedUser) {
    return this.publicHolidaysService.create(dto, user.role);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'public_holiday' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePublicHolidayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.publicHolidaysService.update(id, dto, user.role);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'public_holiday' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.publicHolidaysService.remove(id, user.role);
  }
}
