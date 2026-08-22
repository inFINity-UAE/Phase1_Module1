import { PartialType } from '@nestjs/mapped-types';
import { CreateAccountingPeriodDto } from './create-accounting-period.dto';

export class UpdateAccountingPeriodDto extends PartialType(CreateAccountingPeriodDto) {}
