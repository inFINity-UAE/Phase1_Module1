import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import {
  handleDatabaseError,
  isPostgrestError,
} from '../common/errors/database-error.mapper';
import { CompanyRole } from '../common/enums/company-role.enum';
import { PeriodStatus } from '../common/enums/period-status.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { ActorContext } from '../auth/actor-context';
import { CompanyMembersService } from '../company-members/company-members.service';
import {
  ACCOUNTING_PERIODS_REPOSITORY,
  AccountingPeriodsRepository,
} from '../accounting-periods/accounting-periods.repository';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { CreateYearEndClosingDto } from './dto/create-year-end-closing.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import {
  ApproveJournalEntryDto,
  PostJournalEntryDto,
  RejectJournalEntryDto,
} from './dto/journal-entry-approval.dto';
import { CreateJournalLineDto } from './dto/create-journal-line.dto';
import { UpdateJournalLineDto } from './dto/update-journal-line.dto';
import { AccountTrialBalance } from './entities/account-trial-balance.entity';
import { JournalEntryWithDetails } from './entities/journal-entry-with-details.entity';
import { JournalEntryReversalResult } from './entities/journal-entry-reversal-result.entity';
import { JournalAttachment } from './entities/journal-attachment.entity';
import { JournalLine } from './entities/journal-line.entity';
import {
  computeEntryTotal,
  formatUnbalancedPostError,
  isJournalBalancePostRejection,
} from './journal-entry-balance.util';
import * as yearEndClosingUtil from './year-end-closing.util';
import {
  JOURNAL_ENTRIES_REPOSITORY,
  JournalEntriesRepository,
} from './journal-entries.repository';

@Injectable()
export class JournalEntriesService {
  constructor(
    @Inject(JOURNAL_ENTRIES_REPOSITORY)
    private readonly journalEntriesRepository: JournalEntriesRepository,
    @Inject(ACCOUNTING_PERIODS_REPOSITORY)
    private readonly accountingPeriodsRepository: AccountingPeriodsRepository,
    private readonly companyMembersService: CompanyMembersService,
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

    const alreadyExists =
      await this.journalEntriesRepository.hasOpeningBalanceForFiscalYear(
        dto.company_id,
        dto.fiscal_year,
      );
    if (alreadyExists) {
      throw new BadRequestException(
        `An opening balance entry already exists for fiscal year ${dto.fiscal_year}. ` +
          'Use a manual adjusting or reversing entry to correct balances instead.',
      );
    }

    const period = await this.journalEntriesRepository.findEarliestOpenPeriod(
      dto.company_id,
      dto.fiscal_year,
    );
    if (!period) {
      throw new BadRequestException(
        `No open accounting period found for fiscal year ${dto.fiscal_year}`,
      );
    }

    let draft: JournalEntryWithDetails | undefined;

    try {
      draft = await this.journalEntriesRepository.insertOpeningBalanceDraft(
        { ...dto, created_by: createdBy },
        period.id,
      );

      const posted = await this.journalEntriesRepository.postEntry(draft.entry.id);

      if (!posted.posted_at) {
        throw new InternalServerErrorException(
          `Opening balance entry ${posted.entry_number} was posted but posted_at was not set`,
        );
      }

      return this.findOne(draft.entry.id);
    } catch (error) {
      if (draft) {
        await this.journalEntriesRepository.deleteEntry(draft.entry.id);
      }

      if (
        draft &&
        isPostgrestError(error) &&
        error.code === 'P0001' &&
        isJournalBalancePostRejection(error.message)
      ) {
        throw new BadRequestException(
          formatUnbalancedPostError(draft.entry.entry_number, draft.lines),
        );
      }

      handleDatabaseError(error);
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
  ): Promise<JournalEntryWithDetails> {
    const alreadyClosed =
      await this.journalEntriesRepository.hasYearEndClosingForFiscalYear(
        dto.company_id,
        dto.fiscal_year,
      );
    if (alreadyClosed) {
      throw new BadRequestException(
        `A year-end closing entry already exists for fiscal year ${dto.fiscal_year}. ` +
          'Running year-end close again would double-transfer P&L into Retained Earnings.',
      );
    }

    const closingPeriod =
      await this.journalEntriesRepository.findLatestPeriodForFiscalYear(
        dto.company_id,
        dto.fiscal_year,
      );
    if (!closingPeriod) {
      throw new BadRequestException(
        `No accounting period found for fiscal year ${dto.fiscal_year}`,
      );
    }

    const retainedEarnings =
      await this.journalEntriesRepository.findRetainedEarningsAccount(dto.company_id);
    if (!retainedEarnings) {
      throw new BadRequestException(
        'Retained Earnings system account (3100) was not found for this company',
      );
    }

    const plBalances =
      await this.journalEntriesRepository.getProfitAndLossBalancesForFiscalYear(
        dto.company_id,
        dto.fiscal_year,
      );
    if (!plBalances.length) {
      throw new BadRequestException(
        `No income or expense balances to close for fiscal year ${dto.fiscal_year}`,
      );
    }

    const lines = yearEndClosingUtil.buildYearEndClosingLines(plBalances, retainedEarnings.id);
    if (!lines.length) {
      throw new BadRequestException(
        `No closing lines could be generated for fiscal year ${dto.fiscal_year}`,
      );
    }

    const entryDate = dto.entry_date ?? closingPeriod.period_end;

    let draft: JournalEntryWithDetails | undefined;

    try {
      draft = await this.journalEntriesRepository.insertYearEndClosingDraft(
        { ...dto, created_by: createdBy },
        closingPeriod.id,
        entryDate,
        lines,
      );

      const posted = await this.journalEntriesRepository.postEntry(draft.entry.id);

      if (!posted.posted_at) {
        throw new InternalServerErrorException(
          `Year-end closing entry ${posted.entry_number} was posted but posted_at was not set`,
        );
      }

      return this.findOne(draft.entry.id);
    } catch (error) {
      if (draft) {
        await this.journalEntriesRepository.deleteEntry(draft.entry.id);
      }

      if (
        draft &&
        isPostgrestError(error) &&
        error.code === 'P0001' &&
        isJournalBalancePostRejection(error.message)
      ) {
        throw new BadRequestException(
          formatUnbalancedPostError(draft.entry.entry_number, draft.lines),
        );
      }

      handleDatabaseError(error);
    }
  }

  async getAccountTrialBalance(
    companyId: string,
    accountId: string,
  ): Promise<AccountTrialBalance | null> {
    try {
      return await this.journalEntriesRepository.getAccountTrialBalance(
        companyId,
        accountId,
      );
    } catch (error) {
      handleDatabaseError(error);
    }
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
  ): Promise<JournalEntryWithDetails> {
    const { role } = await this.companyMembersService.resolveRoleForJournalEntry(userId, id);
    const actor: ActorContext = { id: userId, role };

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
      const threshold = settings?.journal_approval_threshold;

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

    return this.executeDirectPost(id, existing);
  }

  /**
   * [Module 1.6.B] Owner or Manager approves a pending entry — still subject to balance validation.
   */
  async approve(
    id: string,
    userId: string,
    dto: ApproveJournalEntryDto = {},
  ): Promise<JournalEntryWithDetails> {
    const { role } = await this.companyMembersService.resolveRoleForJournalEntry(userId, id);
    const actor: ActorContext = { id: userId, role };
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
  ): Promise<JournalEntryWithDetails> {
    const { role } = await this.companyMembersService.resolveRoleForJournalEntry(userId, id);
    const actor: ActorContext = { id: userId, role };
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
  ): Promise<JournalEntryWithDetails> {
    try {
      const posted = await this.journalEntriesRepository.postEntry(id);

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

  findAll(): JournalEntryWithDetails[] {
    throw new NotImplementedException('Not implemented.');
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

  update(_id: string, _dto: UpdateJournalEntryDto): JournalEntryWithDetails {
    throw new NotImplementedException('Not implemented.');
  }

  createLine(_dto: CreateJournalLineDto) {
    throw new NotImplementedException('Not implemented.');
  }

  async updateLine(id: string, dto: UpdateJournalLineDto): Promise<JournalLine> {
    try {
      return await this.journalEntriesRepository.updateLine(id, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async deleteLine(id: string): Promise<void> {
    try {
      await this.journalEntriesRepository.deleteLine(id);
    } catch (error) {
      handleDatabaseError(error);
    }
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
