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
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { IssueInvoiceDto } from './dto/issue-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { VoidInvoiceDto } from './dto/void-invoice.dto';
import { WriteOffInvoiceDto } from './dto/write-off-invoice.dto';
import { InvoicesService } from './invoices.service';

/** [feature-spec-1.1.C.md §1.3] Invoice header CRUD + status transitions. */
@Controller('invoices')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.create(dto, user.id);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.invoicesService.findAll(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'invoice' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.findOne(id);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'invoice' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceDto) {
    return this.invoicesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'invoice' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.remove(id);
  }

  @Post(':id/issue')
  @RequireCompanyMembership({ type: 'param', resource: 'invoice' })
  issue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: IssueInvoiceDto) {
    return this.invoicesService.issue(id, dto);
  }

  @Post(':id/void')
  @RequireCompanyMembership({ type: 'param', resource: 'invoice' })
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.void(id, dto, user.id);
  }

  @Post(':id/send')
  @RequireCompanyMembership({ type: 'param', resource: 'invoice' })
  send(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.send(id);
  }

  @Post(':id/mark-viewed')
  @RequireCompanyMembership({ type: 'param', resource: 'invoice' })
  markViewed(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.markViewed(id);
  }

  @Post(':id/write-off')
  @RequireCompanyMembership({ type: 'param', resource: 'invoice' })
  writeOff(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WriteOffInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.writeOff(id, dto, user.id, user.role);
  }
}
