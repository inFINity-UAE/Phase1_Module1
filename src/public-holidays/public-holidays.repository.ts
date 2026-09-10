import { PublicHoliday } from './entities/public-holiday.entity';

export const PUBLIC_HOLIDAYS_REPOSITORY = Symbol('PUBLIC_HOLIDAYS_REPOSITORY');

export interface PublicHolidaysRepository {
  findAllForCompany(companyId: string): Promise<PublicHoliday[]>;
  findById(id: string): Promise<PublicHoliday | null>;
  insert(row: {
    company_id: string;
    holiday_date: string;
    description: string;
    source: string | null;
  }): Promise<PublicHoliday>;
  updateDateAndConfirm(id: string, holidayDate: string): Promise<PublicHoliday>;
  delete(id: string): Promise<void>;
}
