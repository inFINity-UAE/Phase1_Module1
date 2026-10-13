import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { CompanyRole } from '../common/enums/company-role.enum';
import { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';
import { UpdatePublicHolidayDto } from './dto/update-public-holiday.dto';
import { PublicHoliday } from './entities/public-holiday.entity';
import {
  PUBLIC_HOLIDAYS_REPOSITORY,
  PublicHolidaysRepository,
} from './public-holidays.repository';

@Injectable()
export class PublicHolidaysService {
  constructor(
    @Inject(PUBLIC_HOLIDAYS_REPOSITORY)
    private readonly publicHolidaysRepository: PublicHolidaysRepository,
  ) {}

  /**
   * [feature-spec-1_1_D.md §3.1b / D-14] Owner or Accountant only.
   */
  private assertHolidayAdmin(role?: CompanyRole): void {
    if (role !== CompanyRole.Owner && role !== CompanyRole.Accountant) {
      throw new ForbiddenException(
        'Only an Owner or Accountant can manage public holidays',
      );
    }
  }

  /** UAE-wide seed rows are not editable through the API. */
  private assertCompanyScoped(row: PublicHoliday): void {
    if (row.company_id == null) {
      throw new BadRequestException(
        'UAE-wide public holidays are not editable through the API',
      );
    }
  }

  findAll(companyId: string, role?: CompanyRole): Promise<PublicHoliday[]> {
    this.assertHolidayAdmin(role);
    return this.publicHolidaysRepository.findAllForCompany(companyId);
  }

  async create(
    dto: CreatePublicHolidayDto,
    role?: CompanyRole,
  ): Promise<PublicHoliday> {
    this.assertHolidayAdmin(role);
    try {
      return await this.publicHolidaysRepository.insert({
        company_id: dto.company_id,
        holiday_date: dto.holiday_date,
        description: dto.description,
        source: dto.source ?? null,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async update(
    id: string,
    dto: UpdatePublicHolidayDto,
    role?: CompanyRole,
  ): Promise<PublicHoliday> {
    this.assertHolidayAdmin(role);
    const existing = await this.publicHolidaysRepository.findById(id);
    if (!existing) throw new NotFoundException(`Public holiday ${id} not found`);
    this.assertCompanyScoped(existing);

    try {
      // [feature-spec-1_1_D.md §3.1b] PATCH moves date and flips CONFIRMED.
      return await this.publicHolidaysRepository.updateDateAndConfirm(
        id,
        dto.holiday_date,
      );
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async remove(id: string, role?: CompanyRole): Promise<void> {
    this.assertHolidayAdmin(role);
    const existing = await this.publicHolidaysRepository.findById(id);
    if (!existing) throw new NotFoundException(`Public holiday ${id} not found`);
    this.assertCompanyScoped(existing);

    try {
      await this.publicHolidaysRepository.delete(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }
}
