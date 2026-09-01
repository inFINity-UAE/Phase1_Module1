import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CreateCreditNoteLineDto } from './dto/create-credit-note-line.dto';
import { UpdateCreditNoteDto } from './dto/update-credit-note.dto';
import { UpdateCreditNoteLineDto } from './dto/update-credit-note-line.dto';
import { CreditNoteLine } from './entities/credit-note-line.entity';
import { CreditNoteWithLines } from './entities/credit-note-with-lines.entity';
import { CreditNote } from './entities/credit-note.entity';
import { CreditNoteStatus } from './common/enums/credit-note-status.enum';

export const CREDIT_NOTES_REPOSITORY = Symbol('CREDIT_NOTES_REPOSITORY');

export type InsertCreditNoteParams = CreateCreditNoteDto & { created_by: string };

export interface CreditNotesRepository {
  insertHeader(params: InsertCreditNoteParams): Promise<CreditNote>;
  findAll(companyId: string): Promise<CreditNote[]>;
  findByIdWithLines(id: string): Promise<CreditNoteWithLines | null>;
  updateHeader(id: string, patch: UpdateCreditNoteDto): Promise<CreditNote>;
  updateStatus(id: string, status: CreditNoteStatus, voidReason?: string): Promise<CreditNote>;
  deleteHeader(id: string): Promise<void>;
  insertLine(creditNoteId: string, dto: CreateCreditNoteLineDto): Promise<CreditNoteLine>;
  updateLine(id: string, dto: UpdateCreditNoteLineDto): Promise<CreditNoteLine>;
  deleteLine(id: string): Promise<void>;
  findCreditNoteIdByLineId(lineId: string): Promise<string | null>;
  findInvoiceForCredit(originalInvoiceId: string): Promise<{
    company_id: string;
    customer_id: string;
    status: string;
  } | null>;
  issueCreditNote(id: string): Promise<CreditNote>;
}
