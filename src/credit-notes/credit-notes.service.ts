import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { InvoiceStatus } from '../invoices/common/enums/invoice-status.enum';
import { CreditNoteStatus } from './common/enums/credit-note-status.enum';
import {
  CREDIT_NOTES_REPOSITORY,
  CreditNotesRepository,
} from './credit-notes.repository';
import { CreateCreditNoteLineDto } from './dto/create-credit-note-line.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { UpdateCreditNoteLineDto } from './dto/update-credit-note-line.dto';
import { UpdateCreditNoteDto } from './dto/update-credit-note.dto';
import { VoidCreditNoteDto } from './dto/void-credit-note.dto';
import { CreditNoteIssueResult, CreditNoteVoidResult } from './entities/credit-note-with-lines.entity';
import { CreditNoteLine } from './entities/credit-note-line.entity';
import { CreditNoteWithLines } from './entities/credit-note-with-lines.entity';
import { CreditNote } from './entities/credit-note.entity';

const STATUS_TRANSITIONS: Record<CreditNoteStatus, CreditNoteStatus[]> = {
  [CreditNoteStatus.Draft]: [CreditNoteStatus.Issued],
  [CreditNoteStatus.Issued]: [CreditNoteStatus.Void],
  [CreditNoteStatus.Void]: [],
};

@Injectable()
export class CreditNotesService {
  constructor(
    @Inject(CREDIT_NOTES_REPOSITORY)
    private readonly creditNotesRepository: CreditNotesRepository,
  ) {}

  async create(dto: CreateCreditNoteDto, createdBy: string): Promise<CreditNoteWithLines> {
    await this.assertOriginalInvoiceCreditable(dto.original_invoice_id, dto.company_id);

    try {
      const creditNote = await this.creditNotesRepository.insertHeader({
        ...dto,
        created_by: createdBy,
      });

      for (const line of dto.lines) {
        this.assertLineInput(line);
        await this.creditNotesRepository.insertLine(creditNote.id, line);
      }

      return this.findOne(creditNote.id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAll(companyId: string): Promise<CreditNote[]> {
    try {
      return await this.creditNotesRepository.findAll(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findOne(id: string): Promise<CreditNoteWithLines> {
    try {
      const result = await this.creditNotesRepository.findByIdWithLines(id);
      if (!result) throw new NotFoundException(`Credit note ${id} not found`);
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      handleDatabaseError(error);
    }
  }

  async update(id: string, dto: UpdateCreditNoteDto): Promise<CreditNoteWithLines> {
    const current = await this.findOne(id);
    this.assertDraft(current.credit_note, 'update');

    if (!dto.credit_note_date) throw new BadRequestException('No updatable fields provided');

    try {
      await this.creditNotesRepository.updateHeader(id, dto);
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async remove(id: string): Promise<void> {
    const current = await this.findOne(id);
    this.assertDraft(current.credit_note, 'delete');
    try {
      await this.creditNotesRepository.deleteHeader(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1_1_C.md §1.4 / §7] Draft → Issued: numbering and atomic
   * credit-note ledger posting via issue_credit_note RPC.
   */
  async issue(id: string): Promise<CreditNoteIssueResult> {
    const current = await this.findOne(id);
    if (current.credit_note.status !== CreditNoteStatus.Draft) {
      throw new BadRequestException(
        `Cannot issue credit note — status is ${current.credit_note.status}`,
      );
    }

    try {
      await this.creditNotesRepository.issueCreditNote(id);
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1_1_C.md §2.2 / §7] Void requires void_reason and atomically
   * reverses journal_entry_id via void_credit_note RPC when posting exists.
   * Decision #14 applies to Issue (partial posting); void uses reverse_journal_entry
   * for the whole document — all-or-nothing, same as invoice void (B3).
   */
  async void(id: string, dto: VoidCreditNoteDto, createdBy: string): Promise<CreditNoteVoidResult> {
    const current = await this.findOne(id);
    const allowed = STATUS_TRANSITIONS[current.credit_note.status] ?? [];
    if (!allowed.includes(CreditNoteStatus.Void)) {
      throw new BadRequestException(
        `Cannot void credit note from status ${current.credit_note.status}`,
      );
    }

    if (!dto.void_reason?.trim()) {
      throw new BadRequestException('void_reason is required to void a credit note');
    }

    try {
      const { ledger_reversal_status } = await this.creditNotesRepository.voidCreditNote(
        id,
        dto.void_reason.trim(),
        createdBy,
      );
      const withLines = await this.findOne(id);
      return {
        ...withLines,
        ledger_reversal_status,
      };
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createLine(
    dto: CreateCreditNoteLineDto & { credit_note_id: string },
  ): Promise<CreditNoteLine> {
    const current = await this.findOne(dto.credit_note_id);
    this.assertDraft(current.credit_note, 'add lines to');
    this.assertLineInput(dto);

    try {
      return await this.creditNotesRepository.insertLine(dto.credit_note_id, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async updateLine(id: string, dto: UpdateCreditNoteLineDto): Promise<CreditNoteLine> {
    const creditNoteId = await this.requireCreditNoteIdForLine(id);
    const current = await this.findOne(creditNoteId);
    this.assertDraft(current.credit_note, 'update lines on');

    try {
      return await this.creditNotesRepository.updateLine(id, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async deleteLine(id: string): Promise<void> {
    const creditNoteId = await this.requireCreditNoteIdForLine(id);
    const current = await this.findOne(creditNoteId);
    this.assertDraft(current.credit_note, 'delete lines from');

    try {
      await this.creditNotesRepository.deleteLine(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private assertLineInput(line: CreateCreditNoteLineDto): void {
    if (line.original_invoice_line_id) return;
    if (line.vat_rate === undefined || line.vat_rate === null) {
      throw new BadRequestException('vat_rate is required for general adjustment lines');
    }
    if (!line.reason?.trim()) {
      throw new BadRequestException('reason is required when original_invoice_line_id is omitted');
    }
  }

  private assertDraft(creditNote: CreditNote, action: string): void {
    if (creditNote.status !== CreditNoteStatus.Draft) {
      throw new BadRequestException(
        `Cannot ${action} credit note ${creditNote.credit_note_number ?? creditNote.id} — status is ${creditNote.status}`,
      );
    }
  }

  private async assertOriginalInvoiceCreditable(
    originalInvoiceId: string,
    companyId: string,
  ): Promise<void> {
    const invoice = await this.creditNotesRepository.findInvoiceForCredit(originalInvoiceId);
    if (!invoice) throw new NotFoundException(`Invoice ${originalInvoiceId} not found`);
    if (invoice.company_id !== companyId) {
      throw new BadRequestException('original_invoice_id does not belong to this company');
    }
    if (invoice.status === InvoiceStatus.Draft) {
      throw new BadRequestException('Cannot credit a draft invoice — issue it first');
    }
    if (invoice.status === InvoiceStatus.Void) {
      throw new BadRequestException('Cannot credit a void invoice');
    }
  }

  private async requireCreditNoteIdForLine(lineId: string): Promise<string> {
    const creditNoteId = await this.creditNotesRepository.findCreditNoteIdByLineId(lineId);
    if (!creditNoteId) throw new NotFoundException(`Credit note line ${lineId} not found`);
    return creditNoteId;
  }
}
