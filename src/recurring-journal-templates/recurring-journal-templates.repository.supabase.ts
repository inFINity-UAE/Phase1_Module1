import { Injectable } from '@nestjs/common';
import { PeriodStatus } from '../common/enums/period-status.enum';
import { SupabaseService } from '../database/supabase.service';
import { AccountingPeriod } from '../accounting-periods/entities/accounting-period.entity';
import { CreateRecurringJournalTemplateDto } from './dto/create-recurring-journal-template.dto';
import { UpdateRecurringJournalTemplateDto } from './dto/update-recurring-journal-template.dto';
import { CreateRecurringJournalTemplateLineDto } from './dto/create-recurring-journal-template-line.dto';
import { UpdateRecurringJournalTemplateLineDto } from './dto/update-recurring-journal-template-line.dto';
import { RecurringJournalTemplate } from './entities/recurring-journal-template.entity';
import { RecurringJournalTemplateLine } from './entities/recurring-journal-template-line.entity';
import { RecurringJournalTemplateWithLines } from './entities/recurring-journal-template-with-lines.entity';
import { RecurringJournalTemplatesRepository, CreateRecurringJournalTemplateWithActor } from './recurring-journal-templates.repository';

@Injectable()
export class SupabaseRecurringJournalTemplatesRepository
  implements RecurringJournalTemplatesRepository
{
  constructor(private readonly supabase: SupabaseService) {}

  async insert(dto: CreateRecurringJournalTemplateWithActor): Promise<RecurringJournalTemplateWithLines> {
    const { data: template, error: templateError } = await this.supabase.client
      .from('recurring_journal_templates')
      .insert({
        company_id: dto.company_id,
        template_name: dto.template_name,
        narration_template: dto.narration_template,
        frequency: dto.frequency,
        start_date: dto.start_date,
        end_date: dto.end_date ?? null,
        next_run_date: dto.next_run_date ?? dto.start_date,
        day_of_month: dto.day_of_month ?? null,
        auto_post: dto.auto_post ?? false,
        is_active: dto.is_active ?? true,
        created_by: dto.created_by,
      })
      .select()
      .single();

    if (templateError) {
      throw templateError;
    }

    const templateRow = template as RecurringJournalTemplate;

    try {
      const lineRows = dto.lines.map((line) => ({
        template_id: templateRow.id,
        line_number: line.line_number,
        account_id: line.account_id,
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
        description: line.description ?? null,
      }));

      const { data: lines, error: linesError } = await this.supabase.client
        .from('recurring_journal_template_lines')
        .insert(lineRows)
        .select();

      if (linesError) {
        throw linesError;
      }

      return {
        template: templateRow,
        lines: (lines ?? []) as RecurringJournalTemplateLine[],
      };
    } catch (error) {
      await this.supabase.client
        .from('recurring_journal_templates')
        .delete()
        .eq('id', templateRow.id);
      throw error;
    }
  }

  async findAll(companyId?: string): Promise<RecurringJournalTemplateWithLines[]> {
    let query = this.supabase.client
      .from('recurring_journal_templates')
      .select('*')
      .order('template_name');

    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    const { data: templates, error } = await query;

    if (error) {
      throw error;
    }

    const results: RecurringJournalTemplateWithLines[] = [];

    for (const template of templates ?? []) {
      const lines = await this.findLinesByTemplateId(template.id);
      results.push({
        template: template as RecurringJournalTemplate,
        lines,
      });
    }

    return results;
  }

  async findByIdWithLines(id: string): Promise<RecurringJournalTemplateWithLines | null> {
    const { data: template, error } = await this.supabase.client
      .from('recurring_journal_templates')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!template) {
      return null;
    }

    const lines = await this.findLinesByTemplateId(id);

    return {
      template: template as RecurringJournalTemplate,
      lines,
    };
  }

  async update(
    id: string,
    dto: UpdateRecurringJournalTemplateDto,
  ): Promise<RecurringJournalTemplate> {
    const payload: Record<string, unknown> = {};

    if (dto.company_id !== undefined) payload.company_id = dto.company_id;
    if (dto.template_name !== undefined) payload.template_name = dto.template_name;
    if (dto.narration_template !== undefined) {
      payload.narration_template = dto.narration_template;
    }
    if (dto.frequency !== undefined) payload.frequency = dto.frequency;
    if (dto.start_date !== undefined) payload.start_date = dto.start_date;
    if (dto.end_date !== undefined) payload.end_date = dto.end_date;
    if (dto.next_run_date !== undefined) payload.next_run_date = dto.next_run_date;
    if (dto.day_of_month !== undefined) payload.day_of_month = dto.day_of_month;
    if (dto.auto_post !== undefined) payload.auto_post = dto.auto_post;
    if (dto.is_active !== undefined) payload.is_active = dto.is_active;

    const { data, error } = await this.supabase.client
      .from('recurring_journal_templates')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as RecurringJournalTemplate;
  }

  async delete(id: string): Promise<void> {
    await this.supabase.client
      .from('recurring_journal_template_lines')
      .delete()
      .eq('template_id', id);

    const { error } = await this.supabase.client
      .from('recurring_journal_templates')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }
  }

  async insertLine(
    templateId: string,
    dto: CreateRecurringJournalTemplateLineDto,
  ): Promise<RecurringJournalTemplateLine> {
    const { data, error } = await this.supabase.client
      .from('recurring_journal_template_lines')
      .insert({
        template_id: templateId,
        line_number: dto.line_number,
        account_id: dto.account_id,
        debit: dto.debit ?? 0,
        credit: dto.credit ?? 0,
        description: dto.description ?? null,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as RecurringJournalTemplateLine;
  }

  async updateLine(
    id: string,
    dto: UpdateRecurringJournalTemplateLineDto,
  ): Promise<RecurringJournalTemplateLine> {
    const payload: Record<string, unknown> = {};

    if (dto.line_number !== undefined) payload.line_number = dto.line_number;
    if (dto.account_id !== undefined) payload.account_id = dto.account_id;
    if (dto.debit !== undefined) payload.debit = dto.debit;
    if (dto.credit !== undefined) payload.credit = dto.credit;
    if (dto.description !== undefined) payload.description = dto.description;

    const { data, error } = await this.supabase.client
      .from('recurring_journal_template_lines')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as RecurringJournalTemplateLine;
  }

  async deleteLine(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('recurring_journal_template_lines')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }
  }

  async findDueTemplates(asOfDate: string): Promise<RecurringJournalTemplateWithLines[]> {
    const { data: templates, error } = await this.supabase.client
      .from('recurring_journal_templates')
      .select('*')
      .eq('is_active', true)
      .lte('next_run_date', asOfDate)
      .order('next_run_date');

    if (error) {
      throw error;
    }

    const due: RecurringJournalTemplateWithLines[] = [];

    for (const template of templates ?? []) {
      if (template.end_date && template.next_run_date > template.end_date) {
        continue;
      }

      const lines = await this.findLinesByTemplateId(template.id);
      due.push({
        template: template as RecurringJournalTemplate,
        lines,
      });
    }

    return due;
  }

  async findOpenPeriodForDate(
    companyId: string,
    date: string,
  ): Promise<AccountingPeriod | null> {
    const { data, error } = await this.supabase.client
      .from('accounting_periods')
      .select('*')
      .eq('company_id', companyId)
      .eq('status', PeriodStatus.Open)
      .lte('period_start', date)
      .gte('period_end', date)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as AccountingPeriod | null;
  }

  async updateSchedule(
    id: string,
    nextRunDate: string,
    isActive: boolean,
  ): Promise<RecurringJournalTemplate> {
    const { data, error } = await this.supabase.client
      .from('recurring_journal_templates')
      .update({
        next_run_date: nextRunDate,
        is_active: isActive,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as RecurringJournalTemplate;
  }

  private async findLinesByTemplateId(templateId: string): Promise<RecurringJournalTemplateLine[]> {
    const { data, error } = await this.supabase.client
      .from('recurring_journal_template_lines')
      .select('*')
      .eq('template_id', templateId)
      .order('line_number');

    if (error) {
      throw error;
    }

    return (data ?? []) as RecurringJournalTemplateLine[];
  }
}
