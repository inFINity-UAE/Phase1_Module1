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
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QuotationsService } from './quotations.service';

/** [feature-spec-1_1_C.md §1.2] Quotation header CRUD + status transitions. */
@Controller('quotations')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateQuotationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.quotationsService.create(dto, user.id);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.quotationsService.findAll(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'quotation' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotationsService.findOne(id);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'quotation' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuotationDto) {
    return this.quotationsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'quotation' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotationsService.remove(id);
  }

  @Post(':id/send')
  @RequireCompanyMembership({ type: 'param', resource: 'quotation' })
  send(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotationsService.send(id);
  }

  @Post(':id/mark-viewed')
  @RequireCompanyMembership({ type: 'param', resource: 'quotation' })
  markViewed(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotationsService.markViewed(id);
  }

  @Post(':id/accept')
  @RequireCompanyMembership({ type: 'param', resource: 'quotation' })
  accept(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotationsService.accept(id);
  }

  @Post(':id/decline')
  @RequireCompanyMembership({ type: 'param', resource: 'quotation' })
  decline(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotationsService.decline(id);
  }

  @Post(':id/convert')
  @RequireCompanyMembership({ type: 'param', resource: 'quotation' })
  convert(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.quotationsService.convert(id, user.id);
  }
}
