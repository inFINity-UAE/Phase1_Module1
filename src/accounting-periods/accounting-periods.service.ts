import { Injectable, NotImplementedException } from '@nestjs/common';
import { CreateAccountingPeriodDto } from './dto/create-accounting-period.dto';
import { UpdateAccountingPeriodDto } from './dto/update-accounting-period.dto';
import { AccountingPeriod } from './entities/accounting-period.entity';

@Injectable()
export class AccountingPeriodsService {
  create(_dto: CreateAccountingPeriodDto): AccountingPeriod {
    throw new NotImplementedException('Not implemented.');
  }

  findAll(): AccountingPeriod[] {
    throw new NotImplementedException('Not implemented.');
  }

  findOne(_id: string): AccountingPeriod {
    throw new NotImplementedException('Not implemented.');
  }

  update(_id: string, _dto: UpdateAccountingPeriodDto): AccountingPeriod {
    throw new NotImplementedException('Not implemented.');
  }
}
