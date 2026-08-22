import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { SoftCloseAccountingPeriodDto } from './dto/soft-close-accounting-period.dto';
import { CreateAccountingPeriodDto } from './dto/create-accounting-period.dto';
import { UpdateAccountingPeriodDto } from './dto/update-accounting-period.dto';
import { AccountingPeriod } from './entities/accounting-period.entity';
import {
  ACCOUNTING_PERIODS_REPOSITORY,
  AccountingPeriodsRepository,
} from './accounting-periods.repository';

@Injectable()
export class AccountingPeriodsService {
  constructor(
    @Inject(ACCOUNTING_PERIODS_REPOSITORY)
    private readonly periodsRepository: AccountingPeriodsRepository,
  ) {}

  create(_dto: CreateAccountingPeriodDto): AccountingPeriod {
    throw new NotImplementedException('Not implemented.');
  }

  findAll(): AccountingPeriod[] {
    throw new NotImplementedException('Not implemented.');
  }

  async findOne(id: string): Promise<AccountingPeriod> {
    try {
      const period = await this.periodsRepository.findById(id);
      if (!period) {
        throw new NotFoundException(`Accounting period ${id} not found`);
      }
      return period;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      handleDatabaseError(error);
    }
  }

  update(_id: string, _dto: UpdateAccountingPeriodDto): AccountingPeriod {
    throw new NotImplementedException('Not implemented.');
  }

  /** [feature-spec] Period soft-close with override permission for corrections. */
  async softClose(id: string, dto: SoftCloseAccountingPeriodDto): Promise<AccountingPeriod> {
    await this.findOne(id);

    try {
      return await this.periodsRepository.softClose(id, dto.closed_by);
    } catch (error) {
      handleDatabaseError(error);
    }
  }
}
