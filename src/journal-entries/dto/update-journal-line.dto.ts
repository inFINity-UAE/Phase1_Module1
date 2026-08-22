import { PartialType } from '@nestjs/mapped-types';
import { CreateJournalLineDto } from './create-journal-line.dto';

export class UpdateJournalLineDto extends PartialType(CreateJournalLineDto) {}
