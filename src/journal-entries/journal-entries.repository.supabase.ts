import { Injectable } from '@nestjs/common';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { SupabaseService } from '../database/supabase.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { JournalAttachment } from './entities/journal-attachment.entity';
import { JournalEntryWithDetails } from './entities/journal-entry-with-details.entity';
import { JournalEntriesRepository } from './journal-entries.repository';

@Injectable()
export class SupabaseJournalEntriesRepository implements JournalEntriesRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async getNextEntryNumber(companyId: string): Promise<number> {
    const { data, error } = await this.supabase.client
      .from('journal_entries')
      .select('entry_number')
      .eq('company_id', companyId)
      .order('entry_number', { ascending: false })
      .limit(1);

    if (error) {
      throw error;
    }

    const max = data?.[0]?.entry_number;
    return typeof max === 'number' ? max + 1 : 1;
  }

  async insertDraft(dto: CreateJournalEntryDto): Promise<JournalEntryWithDetails> {
    const entryNumber = await this.getNextEntryNumber(dto.company_id);

    const { data: entry, error: entryError } = await this.supabase.client
      .from('journal_entries')
      .insert({
        company_id: dto.company_id,
        entry_number: entryNumber,
        period_id: dto.period_id,
        entry_date: dto.entry_date,
        entry_type: JournalEntryType.Manual,
        status: JournalEntryStatus.Draft,
        narration: dto.narration,
        reference_number: dto.reference_number ?? null,
        created_by: dto.created_by,
      })
      .select()
      .single();

    if (entryError) {
      throw entryError;
    }

    const entryRow = entry as JournalEntry;

    try {
      const lineRows = dto.lines.map((line) => ({
        journal_entry_id: entryRow.id,
        line_number: line.line_number,
        account_id: line.account_id,
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
        description: line.description ?? null,
        cost_center: line.cost_center ?? null,
      }));

      const { data: lines, error: linesError } = await this.supabase.client
        .from('journal_lines')
        .insert(lineRows)
        .select();

      if (linesError) {
        throw linesError;
      }

      let attachments: JournalAttachment[] = [];

      if (dto.attachments?.length) {
        const attachmentRows = dto.attachments.map((attachment) => ({
          journal_entry_id: entryRow.id,
          file_name: attachment.file_name,
          file_url: attachment.file_url,
          file_size_bytes: attachment.file_size_bytes ?? null,
          uploaded_by: dto.created_by,
        }));

        const { data: attachmentData, error: attachmentError } =
          await this.supabase.client
            .from('journal_attachments')
            .insert(attachmentRows)
            .select();

        if (attachmentError) {
          throw attachmentError;
        }

        attachments = (attachmentData ?? []) as JournalAttachment[];
      }

      return {
        entry: entryRow,
        lines: (lines ?? []) as JournalLine[],
        attachments,
      };
    } catch (error) {
      await this.supabase.client
        .from('journal_entries')
        .delete()
        .eq('id', entryRow.id);
      throw error;
    }
  }

  async findByIdWithDetails(id: string): Promise<JournalEntryWithDetails | null> {
    const { data: entry, error: entryError } = await this.supabase.client
      .from('journal_entries')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (entryError) {
      throw entryError;
    }

    if (!entry) {
      return null;
    }

    const { data: lines, error: linesError } = await this.supabase.client
      .from('journal_lines')
      .select('*')
      .eq('journal_entry_id', id)
      .order('line_number');

    if (linesError) {
      throw linesError;
    }

    const attachments = await this.findAttachmentsByEntryId(id);

    return {
      entry: entry as JournalEntry,
      lines: (lines ?? []) as JournalLine[],
      attachments,
    };
  }

  async findAttachmentsByEntryId(entryId: string): Promise<JournalAttachment[]> {
    const { data, error } = await this.supabase.client
      .from('journal_attachments')
      .select('*')
      .eq('journal_entry_id', entryId)
      .order('uploaded_at');

    if (error) {
      throw error;
    }

    return (data ?? []) as JournalAttachment[];
  }
}
