import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { PeriodStatus } from '../common/enums/period-status.enum';
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

  /**
   * [feature-spec.md decision #30 / #38] Create open period. Overlap rejected
   * in-app for a clean 409; DB exclusion constraint
   * `accounting_periods_company_daterange_excl` is the concurrent-write backstop.
   */
  async create(dto: CreateAccountingPeriodDto): Promise<AccountingPeriod> {
    this.assertValidDateRange(dto.period_start, dto.period_end);

    try {
      const overlaps = await this.periodsRepository.hasOverlappingPeriod(
        dto.company_id,
        dto.period_start,
        dto.period_end,
      );
      if (overlaps) {
        throw new ConflictException(
          'Accounting period overlaps an existing period for this company',
        );
      }

      return await this.periodsRepository.create({
        company_id: dto.company_id,
        period_start: dto.period_start,
        period_end: dto.period_end,
        fiscal_year: dto.fiscal_year,
      });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec.md decision #30] Company-scoped chronological list.
   * company_id is a required query param — same tenant-scoping shape as
   * AccountsController.findAll (AuthenticatedUser has no company_id).
   */
  async findAll(companyId: string): Promise<AccountingPeriod[]> {
    if (!companyId) {
      throw new BadRequestException('company_id query parameter is required');
    }

    try {
      return await this.periodsRepository.findByCompanyId(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
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

  /**
   * [feature-spec.md decision #30] Editable: period_start / period_end / fiscal_year
   * only while status is open and no posted journal activity exists. Status
   * transitions go through soft-close only — UpdateAccountingPeriodDto rejects
   * status via forbidNonWhitelisted.
   */
  async update(id: string, dto: UpdateAccountingPeriodDto): Promise<AccountingPeriod> {
    const period = await this.findOne(id);

    if (period.status !== PeriodStatus.Open) {
      throw new BadRequestException(
        `Cannot update accounting period ${id} while status is '${period.status}' — soft-close is the only status transition path`,
      );
    }

    const hasPatch =
      dto.period_start !== undefined ||
      dto.period_end !== undefined ||
      dto.fiscal_year !== undefined;
    if (!hasPatch) {
      throw new BadRequestException('No updatable fields provided');
    }

    try {
      const hasPosted = await this.periodsRepository.hasPostedJournalActivity(id);
      if (hasPosted) {
        throw new ConflictException(
          `Cannot update accounting period ${id} — it has posted journal entries`,
        );
      }

      const nextStart = dto.period_start ?? period.period_start;
      const nextEnd = dto.period_end ?? period.period_end;
      this.assertValidDateRange(nextStart, nextEnd);

      if (dto.period_start !== undefined || dto.period_end !== undefined) {
        const overlaps = await this.periodsRepository.hasOverlappingPeriod(
          period.company_id,
          nextStart,
          nextEnd,
          id,
        );
        if (overlaps) {
          throw new ConflictException(
            'Accounting period overlaps an existing period for this company',
          );
        }
      }

      return await this.periodsRepository.update(id, {
        ...(dto.period_start !== undefined ? { period_start: dto.period_start } : {}),
        ...(dto.period_end !== undefined ? { period_end: dto.period_end } : {}),
        ...(dto.fiscal_year !== undefined ? { fiscal_year: dto.fiscal_year } : {}),
      });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec] Period soft-close with override permission for corrections.
   * [feature-spec.md decisions #10/#11] closedBy is session user id, not a body field.
   */
  async softClose(id: string, closedBy: string): Promise<AccountingPeriod> {
    await this.findOne(id);

    try {
      return await this.periodsRepository.softClose(id, closedBy);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /** [schema.sql] check (period_end > period_start) — surface before the DB. */
  private assertValidDateRange(periodStart: string, periodEnd: string): void {
    if (periodEnd <= periodStart) {
      throw new BadRequestException('period_end must be greater than period_start');
    }
  }
}
