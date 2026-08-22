import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AccountingPeriodsService } from './accounting-periods.service';
import { CreateAccountingPeriodDto } from './dto/create-accounting-period.dto';
import { UpdateAccountingPeriodDto } from './dto/update-accounting-period.dto';
import { SoftCloseAccountingPeriodDto } from './dto/soft-close-accounting-period.dto';

@Controller('accounting-periods')
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

  @Post(':id/soft-close')
  softClose(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SoftCloseAccountingPeriodDto,
  ) {
    return this.accountingPeriodsService.softClose(id, dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountingPeriodDto,
  ) {
    return this.accountingPeriodsService.update(id, dto);
  }
}
