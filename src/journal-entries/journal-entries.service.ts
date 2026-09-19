import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  handleDatabaseError,
  isPostgrestError,
} from '../common/errors/database-error.mapper';
import { CompanyRole } from '../common/enums/company-role.enum';
import { PeriodStatus } from '../common/enums/period-status.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { ActorContext } from '../auth/actor-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CompanyMembersService } from '../company-members/company-members.service';
import {
  ACCOUNTING_PERIODS_REPOSITORY,
  AccountingPeriodsRepository,
} from '../accounting-periods/accounting-periods.repository';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { CreateYearEndClosingDto } from './dto/create-year-end-closing.dto';
import { AccrueUnbilledReceiptsDto } from './dto/accrue-unbilled-receipts.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import {
  ApproveJournalEntryDto,
  PostJournalEntryDto,
  RejectJournalEntryDto,
} from './dto/journal-entry-approval.dto';
import { CreateJournalLineDto } from './dto/create-journal-line.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';
import { JournalEntryWithDetails } from './entities/journal-entry-with-details.entity';
import { JournalEntryReversalResult } from './entities/journal-entry-reversal-result.entity';
import { JournalAttachment } from './entities/journal-attachment.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import {
  computeEntryTotal,
  formatUnbalancedPostError,
  isJournalBalancePostRejection,
} from './journal-entry-balance.util';
import {
  JOURNAL_ENTRIES_REPOSITORY,
  JournalEntriesRepository,
} from './journal-entries.repository';
import { assertEntryDateWithinPeriod } from './journal-period.validation';
import { CompanySettings } from '../company-settings/entities/company-settings.entity';

const POSTED_ENTRY_DELETE_BLOCKED = 'POSTED_ENTRY_DELETE_BLOCKED';
const POSTED_LINE_DELETE_BLOCKED = 'POSTED_LINE_DELETE_BLOCKED';

const POSTED_ENTRY_DELETE_MESSAGE =
  'Posted journal entries cannot be deleted — use a reversing entry (entry_type = reversal)';
const POSTED_LINE_DELETE_MESSAGE =
  'Cannot modify lines of a posted journal entry — reverse it instead';

/**
 * [feature-spec-1_1_D.md D-11] Which approval threshold applies for this entry_type.
 * null = approval disabled (post directly). ecl_provision is always non-blocking.
 */
export function resolveApprovalThreshold(
  entryType: JournalEntryType,
  settings: CompanySettings | null,
): number | null {
  if (entryType === JournalEntryType.EclProvision) {
    return null;
  }
  if (entryType === JournalEntryType.WriteOff) {
    return settings != null ? Number(settings.write_off_approval_threshold) : 5000;
  }
  if (settings?.journal_approval_threshold == null) {
    return null;
  }
  return Number(settings.journal_approval_threshold);
}

@Injectable()
export class JournalEntriesService {
  constructor(
    @Inject(JOURNAL_ENTRIES_REPOSITORY)
    private readonly journalEntriesRepository: JournalEntriesRepository,
    @Inject(ACCOUNTING_PERIODS_REPOSITORY)
    private readonly accountingPeriodsRepository: AccountingPeriodsRepository,
    private readonly companyMembersService: CompanyMembersService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * [feature-spec] Manual journal entry as draft — balance enforced on post only
   * [schema] enforce_journal_balance_on_post
   */
  async create(dto: CreateJournalEntryDto, createdBy: string): Promise<JournalEntryWithDetails> {
    if (!dto.lines?.length) {
      throw new BadRequestException('Journal entry must have at least one line');
    }

    try {
      return await this.journalEntriesRepository.insertDraft({ ...dto, created_by: createdBy });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec] Opening balance entry for mid-year setup.
   * [Product decision 2026-08-21] One-time per company per fiscal year.
   * [Rules §1.1] Same balance enforcement on post as any other entry.
   */
  async createOpeningBalance(
    dto: CreateOpeningBalanceDto,
    createdBy: string,
  ): Promise<JournalEntryWithDetails> {
    if (!dto.lines?.length) {
      throw new BadRequestException('Opening balance entry must have at least one line');
    }

    try {
      const posted = await this.journalEntriesRepository.createOpeningBalanceEntry({
        ...dto,
        created_by: createdBy,
      });

      if (!posted.entry.posted_at) {
        throw new InternalServerErrorException(
          `Opening balance entry ${posted.entry.entry_number} was posted but posted_at was not set`,
        );
      }

      return posted;
    } catch (error) {
      this.throwMappedJournalRpcError(error, dto.fiscal_year);
    }
  }

  /**
   * [feature-spec] Year-end closing: transfer P&L to Retained Earnings.
   * [Rules §4.11] Balance-sheet accounts roll forward unchanged.
   * [Product decision 2026-08-21] One-time per company per fiscal year.
   */
  async runYearEndClosing(
    dto: CreateYearEndClosingDto,
    createdBy: string,
    role?: CompanyRole,
  ): Promise<JournalEntryWithDetails> {
    if (dto.skip_ct_check) {
      // [feature-spec-1_1_G.md G-32] Owner-only skip, E-25 analogue.
      if (role !== CompanyRole.Owner) {
        throw new ForbiddenException('Only Owner can skip the CT provision check on year-end close');
      }
      if (!dto.skip_reason?.trim()) {
        throw new BadRequestException('skip_reason is required when skip_ct_check is true');
      }
    }
    try {
      const posted = await this.journalEntriesRepository.createYearEndClosingEntry({
        ...dto,
        created_by: createdBy,
      });

      if (!posted.entry.posted_at) {
        throw new InternalServerErrorException(
          `Year-end closing entry ${posted.entry.entry_number} was posted but posted_at was not set`,
        );
      }

      return posted;
    } catch (error) {
      this.throwMappedJournalRpcError(error, dto.fiscal_year);
    }
  }

  /**
   * [feature-spec-1_1_E.md E-21 / §5.5] Period-end GRNI accrual via RPC.
   * Not a cron — month-end is a human call.
   */
  async accrueUnbilledReceipts(
    dto: AccrueUnbilledReceiptsDto,
    createdBy: string,
  ): Promise<unknown> {
    try {
      return await this.journalEntriesRepository.accrueUnbilledReceipts(
        dto.company_id,
        dto.period_end_date,
        createdBy,
      );
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Map RPC RAISE tokens to the existing Nest error strings.
   * NO_OPEN_PERIOD_FOR_FISCAL_YEAR = opening-balance earliest *open* period.
   * NO_PERIOD_FOR_FISCAL_YEAR = year-end latest period of any status.
   */
  private throwMappedJournalRpcError(error: unknown, fiscalYear: number): never {
    const message = error instanceof Error ? error.message : '';

    if (message === 'OPENING_BALANCE_ALREADY_EXISTS') {
      throw new BadRequestException(
        `An opening balance entry already exists for fiscal year ${fiscalYear}. ` +
          'Use a manual adjusting or reversing entry to correct balances instead.',
      );
    }
    if (message === 'OPENING_BALANCE_INVALID_ACCOUNT_CATEGORY') {
      throw new BadRequestException(
        'Opening balance lines may only use asset, liability, or equity accounts — ' +
          'income and expense accounts are not allowed',
      );
    }
    if (message === 'YEAR_END_ALREADY_CLOSED') {
      throw new BadRequestException(
        `A year-end closing entry already exists for fiscal year ${fiscalYear}. ` +
          'Running year-end close again would double-transfer P&L into Retained Earnings.',
      );
    }
    if (message === 'CT_PROVISION_NOT_POSTED') {
      throw new BadRequestException(
        `No posted CT provision exists for fiscal year ${fiscalYear}. ` +
          'Post create_ct_provision_entry first, or pass skip_ct_check with skip_reason.',
      );
    }
    if (message === 'NO_OPEN_PERIOD_FOR_FISCAL_YEAR') {
      throw new BadRequestException(
        `No open accounting period found for fiscal year ${fiscalYear}`,
      );
    }
    if (message === 'NO_PERIOD_FOR_FISCAL_YEAR') {
      throw new BadRequestException(
        `No accounting period found for fiscal year ${fiscalYear}`,
      );
    }
    if (message === 'RETAINED_EARNINGS_NOT_FOUND') {
      throw new BadRequestException(
        'Retained Earnings system account (3100) was not found for this company',
      );
    }
    if (message === 'NO_PL_BALANCES_TO_CLOSE') {
      throw new BadRequestException(
        `No income or expense balances to close for fiscal year ${fiscalYear}`,
      );
    }
    if (message === 'JOURNAL_DRAFT_REQUIRES_LINES') {
      throw new BadRequestException('Journal entry must have at least one line');
    }

    if (
      isPostgrestError(error) &&
      error.code === 'P0001' &&
      isJournalBalancePostRejection(error.message)
    ) {
      throw new BadRequestException(error.message);
    }

    handleDatabaseError(error);
  }

  /**
   * Post a draft journal entry. [Rules §1.1] debits must equal credits.
   * [Rules §1.24] Entries at/above threshold require Owner approval unless poster is Owner.
   * [Product decision 2026-08-21] Owner bypasses approval workflow on draft → post.
   * [company_members.sql §11] actor role resolved server-side — never from request body.
   */
  async post(
    id: string,
    userId: string,
    dto: PostJournalEntryDto = {},
    /**
     * [feature-spec.md decision #41] Role from CompanyMembershipGuard when
     * present — avoids a second company_members lookup on HTTP post.
     */
    role?: CompanyRole,
  ): Promise<JournalEntryWithDetails> {
    const actorRole =
      role ??
      (await this.companyMembersService.resolveRoleForJournalEntry(userId, id)).role;
    const actor: ActorContext = { id: userId, role: actorRole };

    const existing = await this.findOne(id);

    if (existing.entry.status !== JournalEntryStatus.Draft) {
      throw new BadRequestException(
        `Journal entry ${existing.entry.entry_number} is not a draft and cannot be posted`,
      );
    }

    await this.assertPeriodAllowsPosting(
      existing.entry.period_id,
      existing.entry.company_id,
      actor.id,
      actor.role,
      dto.soft_closed_override_reason,
    );

    const isOwner = actor.role === CompanyRole.Owner;

    if (!isOwner) {
      const settings = await this.journalEntriesRepository.getCompanySettings(
        existing.entry.company_id,
      );
      // [feature-spec-1_1_D.md D-11] Threshold by entry_type — reuse A's post path.
      const threshold = resolveApprovalThreshold(
        existing.entry.entry_type as JournalEntryType,
        settings,
      );

      if (threshold != null) {
        const entryTotal = computeEntryTotal(existing.lines);

        if (entryTotal >= Number(threshold)) {
          try {
            await this.journalEntriesRepository.submitForApproval(id);
            return this.findOne(id);
          } catch (error) {
            handleDatabaseError(error);
          }
        }
      }
    }

    return this.executeDirectPost(id, existing, isOwner ? actor.id : undefined);
  }

  /**
   * [Module 1.6.B] Owner or Manager approves a pending entry — still subject to balance validation.
   */
  async approve(
    id: string,
    userId: string,
    dto: ApproveJournalEntryDto = {},
    /** [feature-spec.md decision #41] Prefer role already resolved by the guard. */
    role?: CompanyRole,
  ): Promise<JournalEntryWithDetails> {
    const actorRole =
      role ??
      (await this.companyMembersService.resolveRoleForJournalEntry(userId, id)).role;
    const actor: ActorContext = { id: userId, role: actorRole };
    this.assertApprovalActor(actor.role, 'approve');

    const existing = await this.findOne(id);

    if (existing.entry.status !== JournalEntryStatus.PendingApproval) {
      throw new BadRequestException(
        `Journal entry ${existing.entry.entry_number} is not pending approval`,
      );
    }

    await this.assertPeriodAllowsPosting(
      existing.entry.period_id,
      existing.entry.company_id,
      actor.id,
      actor.role,
      dto.soft_closed_override_reason,
    );

    try {
      const posted = await this.journalEntriesRepository.approveAndPostEntry(id, actor.id);

      if (!posted.posted_at) {
        throw new InternalServerErrorException(
          `Journal entry ${posted.entry_number} was approved but posted_at was not set`,
        );
      }

      return this.findOne(id);
    } catch (error) {
      this.handlePostError(error, existing);
    }
  }

  /**
   * [Module 1.6.B] Owner or Manager rejects a pending entry — entry remains unposted.
   */
  async reject(
    id: string,
    userId: string,
    dto: RejectJournalEntryDto,
    /** [feature-spec.md decision #41] Prefer role already resolved by the guard. */
    role?: CompanyRole,
  ): Promise<JournalEntryWithDetails> {
    const actorRole =
      role ??
      (await this.companyMembersService.resolveRoleForJournalEntry(userId, id)).role;
    const actor: ActorContext = { id: userId, role: actorRole };
    this.assertApprovalActor(actor.role, 'reject');

    const existing = await this.findOne(id);

    if (existing.entry.status !== JournalEntryStatus.PendingApproval) {
      throw new BadRequestException(
        `Journal entry ${existing.entry.entry_number} is not pending approval`,
      );
    }

    try {
      await this.journalEntriesRepository.rejectEntry(id, actor.id, dto.rejection_reason);
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private async executeDirectPost(
    id: string,
    existing: JournalEntryWithDetails,
    /**
     * [feature-spec.md #55] When the poster is Owner and created the entry,
     * pass their id so postEntry stamps approved_by = created_by and the
     * audit trigger writes notes = 'Self-approved by Owner'.
     */
    ownerSelfApproveId?: string,
  ): Promise<JournalEntryWithDetails> {
    try {
      const approvedBy =
        ownerSelfApproveId && existing.entry.created_by === ownerSelfApproveId
          ? ownerSelfApproveId
          : undefined;
      const posted = approvedBy
        ? await this.journalEntriesRepository.postEntry(id, approvedBy)
        : await this.journalEntriesRepository.postEntry(id);

      if (!posted.posted_at) {
        throw new InternalServerErrorException(
          `Journal entry ${posted.entry_number} was posted but posted_at was not set`,
        );
      }

      return this.findOne(id);
    } catch (error) {
      this.handlePostError(error, existing);
    }
  }

  // [Module 1.6.B] Manager: approve journals — no data entry; Owner retains full control.
  private assertApprovalActor(role: CompanyRole, action: 'approve' | 'reject'): void {
    if (role !== CompanyRole.Owner && role !== CompanyRole.Manager) {
      throw new ForbiddenException(
        `Only an Owner or Manager can ${action} journal entries pending approval`,
      );
    }
  }

  /**
   * [feature-spec] Soft-closed periods block posting unless Owner override with reason.
   * [Rules §1.3] Prior-period adjustment logged on accounting_periods.reopen_* columns.
   */
  private async assertPeriodAllowsPosting(
    periodId: string,
    companyId: string,
    actorId: string,
    actorRole: CompanyRole,
    overrideReason?: string,
  ): Promise<void> {
    const period = await this.accountingPeriodsRepository.findById(periodId);

    if (!period) {
      throw new BadRequestException(`Accounting period ${periodId} not found`);
    }

    if (period.status === PeriodStatus.Open) {
      return;
    }

    if (
      period.status === PeriodStatus.SoftClosed ||
      period.status === PeriodStatus.Closed
    ) {
      if (!overrideReason?.trim()) {
        throw new BadRequestException(
          `Accounting period ${period.period_start} to ${period.period_end} is ${period.status} — ` +
            'provide soft_closed_override_reason to post a correction',
        );
      }

      if (actorRole !== CompanyRole.Owner) {
        throw new ForbiddenException(
          'Only an Owner may post into a soft-closed period with override',
        );
      }

      const settings = await this.journalEntriesRepository.getCompanySettings(companyId);

      if (settings && !settings.allow_period_reopen) {
        throw new ForbiddenException(
          'Period posting override is disabled for this company',
        );
      }

      try {
        await this.accountingPeriodsRepository.logSoftClosedPostingOverride(
          periodId,
          actorId,
          overrideReason.trim(),
        );
      } catch (error) {
        handleDatabaseError(error);
      }

      return;
    }

    throw new BadRequestException(
      `Accounting period ${period.period_start} to ${period.period_end} does not allow postings`,
    );
  }

  /**
   * [feature-spec] One-click reversal in the next open period.
   * [Rules §1.3] Corrections via reversing entries — preserve audit trail.
   * [Product decision 2026-08-21] An entry cannot be reversed twice.
   * [feature-spec decision #10] createdBy must be the authenticated session
   * user id from the controller — never a client-supplied body field.
   */
  async reverse(id: string, createdBy: string): Promise<JournalEntryReversalResult> {
    const existing = await this.findOne(id);
    this.assertReversible(existing);

    const originalPeriod = await this.journalEntriesRepository.findPeriodById(
      existing.entry.period_id,
    );
    if (!originalPeriod) {
      throw new BadRequestException(
        `Accounting period for journal entry ${existing.entry.entry_number} was not found`,
      );
    }

    const nextPeriod = await this.journalEntriesRepository.findNextOpenPeriod(
      existing.entry.company_id,
      originalPeriod.period_end,
    );
    if (!nextPeriod) {
      throw new BadRequestException(
        `No open accounting period exists after ${originalPeriod.period_end} — ` +
          'create the next period before reversing this entry',
      );
    }

    try {
      return await this.journalEntriesRepository.reverseEntry(id, createdBy);
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_NEXT_OPEN_PERIOD') {
        throw new BadRequestException(
          `No open accounting period exists after ${originalPeriod.period_end} — ` +
            'create the next period before reversing this entry',
        );
      }
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec.md decision #31] Company-scoped list (required company_id query
   * param — same pattern as accounting-periods #30). Optional status / period_id
   * filters. Most recent first.
   */
  async findAll(
    companyId: string,
    filters?: { status?: string; period_id?: string },
  ): Promise<JournalEntry[]> {
    if (!companyId) {
      throw new BadRequestException('company_id query parameter is required');
    }

    try {
      return await this.journalEntriesRepository.findByCompany(companyId, filters);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findOne(id: string): Promise<JournalEntryWithDetails> {
    try {
      const result = await this.journalEntriesRepository.findByIdWithDetails(id);
      if (!result) {
        throw new NotFoundException(`Journal entry ${id} not found`);
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      handleDatabaseError(error);
    }
  }

  async getAttachments(entryId: string): Promise<JournalAttachment[]> {
    await this.findOne(entryId);
    try {
      return await this.journalEntriesRepository.findAttachmentsByEntryId(entryId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec.md decision #31] Draft header update only. schema.sql has no
   * trigger blocking UPDATE of posted journal_entries headers (only line mutation
   * and entry deletion) — draft-only is enforced here. Status / lines / identity
   * fields are rejected by UpdateJournalEntryDto + forbidNonWhitelisted.
   */
  async update(
    id: string,
    dto: UpdateJournalEntryDto,
    uploadedBy: string,
  ): Promise<JournalEntryWithDetails> {
    const existing = await this.findOne(id);

    if (existing.entry.status !== JournalEntryStatus.Draft) {
      throw new BadRequestException(
        `Cannot update journal entry ${id} while status is '${existing.entry.status}' — ` +
          'only draft headers are editable; use reverse for posted corrections',
      );
    }

    const hasPatch =
      dto.narration !== undefined ||
      dto.reference_number !== undefined ||
      dto.entry_date !== undefined ||
      dto.attachments !== undefined;
    if (!hasPatch) {
      throw new BadRequestException('No updatable header fields provided');
    }

    if (dto.entry_date !== undefined) {
      const period = await this.accountingPeriodsRepository.findById(
        existing.entry.period_id,
      );
      if (!period) {
        throw new BadRequestException(
          `Accounting period ${existing.entry.period_id} not found`,
        );
      }
      // [§7.30 audit] entry_date must stay within the entry's fixed period.
      assertEntryDateWithinPeriod(dto.entry_date, period);
    }

    try {
      return await this.journalEntriesRepository.updateDraftHeader(id, {
        ...(dto.narration !== undefined ? { narration: dto.narration } : {}),
        ...(dto.reference_number !== undefined
          ? { reference_number: dto.reference_number }
          : {}),
        ...(dto.entry_date !== undefined ? { entry_date: dto.entry_date } : {}),
        ...(dto.attachments !== undefined ? { attachments: dto.attachments } : {}),
        uploaded_by: uploadedBy,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'JOURNAL_ENTRY_HEADER_NOT_DRAFT'
      ) {
        throw new BadRequestException(
          `Cannot update journal entry ${id} — only draft headers are editable; use reverse for posted corrections`,
        );
      }
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec.md decision #32/#35] Add a line to an existing entry.
   * Balance is NOT required here — trg_enforce_journal_balance_on_post only
   * fires on transition to posted. Posted-parent INSERT is rejected by
   * trg_prevent_posted_line_update (P0001 → 400). Account must be active and
   * same-company (#35) — shared assert with insert_journal_entry_draft.
   */
  async createLine(dto: CreateJournalLineDto): Promise<JournalLine> {
    // [schema.sql journal_lines CHECK] debit XOR credit, never both, never zero
    const debit = dto.debit ?? 0;
    const credit = dto.credit ?? 0;
    if (!((debit > 0 && credit === 0) || (credit > 0 && debit === 0))) {
      throw new BadRequestException(
        'Each journal line must have either a positive debit or a positive credit, not both or neither',
      );
    }

    try {
      return await this.journalEntriesRepository.insertLine({
        ...dto,
        debit,
        credit,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async updateLine(id: string, dto: UpdateJournalLineDto): Promise<JournalLine> {
    try {
      return await this.journalEntriesRepository.updateLine(id, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async deleteLine(id: string, actorId: string): Promise<void> {
    // [feature-spec.md #34/#56] Posted-parent DELETE → POSTED_LINE_DELETE_BLOCKED;
    // Nest writes audit_log.delete_blocked in a separate request, then 400.
    const context = await this.journalEntriesRepository.findLineWithCompany(id);
    if (!context) {
      throw new NotFoundException(`Journal line ${id} not found`);
    }

    try {
      await this.journalEntriesRepository.deleteLine(id);
    } catch (error) {
      await this.recordBlockedDeleteIfNeeded(error, {
        token: POSTED_LINE_DELETE_BLOCKED,
        company_id: context.company_id,
        table_name: 'journal_lines',
        record_id: id,
        actor_id: actorId,
        old_data: context.line as unknown as Record<string, unknown>,
        clientMessage: POSTED_LINE_DELETE_MESSAGE,
      });
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec.md #56 / Rules §1.3] Hard-delete. Drafts succeed (cascade);
   * posted entries are rejected by trg_prevent_posted_entry_deletion and
   * recorded in audit_log with action delete_blocked (separate transaction).
   */
  async deleteEntry(id: string, actorId: string): Promise<void> {
    const existing = await this.journalEntriesRepository.findByIdWithDetails(id);
    if (!existing) {
      throw new NotFoundException(`Journal entry ${id} not found`);
    }

    try {
      await this.journalEntriesRepository.deleteEntry(id);
    } catch (error) {
      await this.recordBlockedDeleteIfNeeded(error, {
        token: POSTED_ENTRY_DELETE_BLOCKED,
        company_id: existing.entry.company_id,
        table_name: 'journal_entries',
        record_id: id,
        actor_id: actorId,
        old_data: existing.entry as unknown as Record<string, unknown>,
        clientMessage: POSTED_ENTRY_DELETE_MESSAGE,
      });
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec.md #56] On a known blocked-delete token, insert audit_log
   * outside the failed DELETE transaction, then rethrow as 400.
   */
  private async recordBlockedDeleteIfNeeded(
    error: unknown,
    params: {
      token: string;
      company_id: string;
      table_name: 'journal_entries' | 'journal_lines';
      record_id: string;
      actor_id: string;
      old_data: Record<string, unknown>;
      clientMessage: string;
    },
  ): Promise<void> {
    if (!this.isBlockedDeleteToken(error, params.token)) {
      return;
    }

    await this.auditLogService.recordBlockedDelete({
      company_id: params.company_id,
      table_name: params.table_name,
      record_id: params.record_id,
      actor_id: params.actor_id,
      old_data: params.old_data,
      notes: params.token,
    });

    throw new BadRequestException(params.clientMessage);
  }

  private isBlockedDeleteToken(error: unknown, token: string): boolean {
    if (isPostgrestError(error) && error.code === 'P0001') {
      return (error.message ?? '').includes(token);
    }
    if (error instanceof Error) {
      return error.message.includes(token);
    }
    return false;
  }

  private handlePostError(
    error: unknown,
    existing: JournalEntryWithDetails,
  ): never {
    if (isPostgrestError(error) && error.code === 'P0001') {
      if (isJournalBalancePostRejection(error.message)) {
        throw new BadRequestException(
          formatUnbalancedPostError(existing.entry.entry_number, existing.lines),
        );
      }
      throw new BadRequestException(error.message);
    }

    handleDatabaseError(error);
  }

  private assertReversible(existing: JournalEntryWithDetails): void {
    const { entry_number, status, reversed_by_entry_id, reverses_entry_id, entry_type } =
      existing.entry;

    if (status === JournalEntryStatus.Reversed || reversed_by_entry_id) {
      throw new BadRequestException(
        `Journal entry ${entry_number} has already been reversed and cannot be reversed again`,
      );
    }

    if (status !== JournalEntryStatus.Posted) {
      throw new BadRequestException(
        `Journal entry ${entry_number} must be posted before it can be reversed`,
      );
    }

    if (entry_type === JournalEntryType.Reversal || reverses_entry_id) {
      throw new BadRequestException(
        `Journal entry ${entry_number} is a reversal entry and cannot be reversed`,
      );
    }
  }
}
