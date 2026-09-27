import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUrl,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';
import { DOCUMENT_BATCH_MAX } from '../document-ocr.constants';

export class DocumentBatchFileDto {
  @IsString()
  @MinLength(1)
  file_name!: string;

  /** Veryfi fetches this URL. Bytes are not put on the Redis job. */
  @IsUrl({ require_protocol: true, require_tld: false })
  file_url!: string;
}

/** [feature-spec-1_1_B.md §4] Batch enqueue. company_id is membership-checked. */
export class CreateDocumentBatchDto {
  @IsPostgresUuid()
  company_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DOCUMENT_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => DocumentBatchFileDto)
  documents!: DocumentBatchFileDto[];
}

export class DocumentBatchQueryDto {
  @IsPostgresUuid()
  company_id!: string;
}
