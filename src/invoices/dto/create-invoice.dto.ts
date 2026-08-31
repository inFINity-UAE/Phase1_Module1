import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { PaymentTermsType } from '../common/enums/payment-terms-type.enum';
import { CreateInvoiceLineDto } from './create-invoice-line.dto';

export class CreateInvoiceDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsPostgresUuid()
  customer_id!: string;

  @IsDateString()
  invoice_date!: string;

  @IsOptional()
  @IsEnum(PaymentTermsType)
  payment_terms?: PaymentTermsType;

  @ValidateIf((dto: CreateInvoiceDto) => dto.payment_terms === PaymentTermsType.Custom)
  @IsInt()
  @Min(1)
  custom_days?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceLineDto)
  lines?: CreateInvoiceLineDto[];
}
