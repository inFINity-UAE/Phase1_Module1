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
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SuppliersService } from './suppliers.service';

/**
 * [feature-spec-1_1_E.md §5.5] Supplier CRUD — session + company membership
 * on every route (feature-spec.md decision #41).
 */
@Controller('suppliers')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body' })
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(dto);
  }

  @Get()
  @RequireCompanyMembership({ type: 'query' })
  findAll(@Query('company_id') companyId: string) {
    return this.suppliersService.findAll(companyId);
  }

  @Get(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.findOne(id);
  }

  @Patch(':id/deactivate')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.deactivate(id);
  }

  @Patch(':id')
  @RequireCompanyMembership({ type: 'param', resource: 'supplier' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliersService.update(id, dto);
  }
}
