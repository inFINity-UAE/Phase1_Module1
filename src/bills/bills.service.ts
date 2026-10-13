import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { CompanyRole } from '../common/enums/company-role.enum';
import { PaymentTermsType } from '../invoices/common/enums/payment-terms-type.enum';
import {
  JOURNAL_ENTRIES_REPOSITORY,
  JournalEntriesRepository,
} from '../journal-entries/journal-entries.repository';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { BILLS_REPOSITORY, BillsRepository } from './bills.repository';
import { BillStatus } from './common/enums/bill-status.enum';
import { CreateBillLineDto } from './dto/create-bill-line.dto';
import { CreateBillDto } from './dto/create-bill.dto';
import { DisputeBillDto } from './dto/dispute-bill.dto';
import { OverrideMatchBlockDto } from './dto/override-match-block.dto';
import { ScheduleBillDto } from './dto/schedule-bill.dto';
import { UpdateBillLineDto } from './dto/update-bill-line.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { VoidBillDto } from './dto/void-bill.dto';
import { BillLine } from './entities/bill-line.entity';
import { BillVoidResult, BillWithLines } from './entities/bill-with-lines.entity';
import { Bill } from './entities/bill.entity';

const MUTABLE_STATUSES = new Set([BillStatus.Draft, BillStatus.Matched]);

@Injectable()
export class BillsService {
  constructor(
    @Inject(BILLS_REPOSITORY)
    private readonly billsRepository: BillsRepository,
    @Inject(JOURNAL_ENTRIES_REPOSITORY)
    private readonly journalEntriesRepository: JournalEntriesRepository,
    private readonly journalEntriesService: JournalEntriesService,
  ) {}

  async create(dto: CreateBillDto, createdBy: string): Promise<BillWithLines> {
    await this.assertSupplierUsable(dto.supplier_id, dto.company_id);
    this.assertCustomDaysWhenRequired(dto.payment_terms, dto.custom_days);

    try {
      const bill = await this.billsRepository.insertHeader({
        ...dto,
        created_by: createdBy,
      });

      for (const line of dto.lines ?? []) {
        await this.billsRepository.insertLine(bill.id, line);
      }

      return this.findOne(bill.id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAll(companyId: string, status?: BillStatus): Promise<Bill[]> {
    try {
      return await this.billsRepository.findAll(companyId, status);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findOne(id: string): Promise<BillWithLines> {
    try {
      const result = await this.billsRepository.findByIdWithLines(id);
      if (!result) throw new NotFoundException(`Bill ${id} not found`);
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      handleDatabaseError(error);
    }
  }

  async update(id: string, dto: UpdateBillDto): Promise<BillWithLines> {
    const current = await this.findOne(id);
    this.assertMutable(current.bill, 'update');

    if (dto.supplier_id && dto.supplier_id !== current.bill.supplier_id) {
      await this.assertSupplierUsable(dto.supplier_id, current.bill.company_id);
    }

    const paymentTerms = dto.payment_terms ?? current.bill.payment_terms;
    const customDays = dto.custom_days !== undefined ? dto.custom_days : current.bill.custom_days;
    this.assertCustomDaysWhenRequired(paymentTerms, customDays);

    const hasPatch =
      dto.supplier_id !== undefined ||
      dto.supplier_invoice_number !== undefined ||
      dto.purchase_order_id !== undefined ||
      dto.bill_date !== undefined ||
      dto.payment_terms !== undefined ||
      dto.custom_days !== undefined;
    if (!hasPatch) throw new BadRequestException('No updatable fields provided');

    try {
      await this.billsRepository.updateHeader(id, dto);
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async remove(id: string): Promise<void> {
    const current = await this.findOne(id);
    this.assertMutable(current.bill, 'delete');
    try {
      await this.billsRepository.deleteHeader(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /** [feature-spec-1_1_E.md E-9] */
  async match(id: string): Promise<BillWithLines> {
    await this.findOne(id);
    try {
      await this.billsRepository.runThreeWayMatch(id);
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1_1_E.md E-14 / E-28] Nest computes p_immediate_post; RPC posts.
   * Immediate when Owner, threshold null, or grand_total < journal_approval_threshold.
   */
  async issue(id: string, createdBy: string, role?: CompanyRole): Promise<BillWithLines> {
    const current = await this.findOne(id);
    if (!MUTABLE_STATUSES.has(current.bill.status)) {
      throw new BadRequestException(
        `Cannot issue bill — status is ${current.bill.status}`,
      );
    }

    try {
      const settings = await this.journalEntriesRepository.getCompanySettings(
        current.bill.company_id,
      );
      const threshold = settings?.journal_approval_threshold;
      const immediatePost =
        role === CompanyRole.Owner ||
        threshold == null ||
        Number(current.bill.grand_total) < Number(threshold);

      await this.billsRepository.issueBill(id, createdBy, immediatePost);
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1_1_E.md E-28] Owner/Manager approve the linked JE; trigger
   * flips bill pending_approval → issued.
   */
  async approve(
    id: string,
    userId: string,
    role?: CompanyRole,
  ): Promise<BillWithLines> {
    const current = await this.findOne(id);
    if (current.bill.status !== BillStatus.PendingApproval) {
      throw new BadRequestException(
        `Cannot approve bill from status ${current.bill.status}`,
      );
    }
    if (!current.bill.journal_entry_id) {
      throw new BadRequestException(`Bill ${id} has no journal entry to approve`);
    }

    const actorRole = role ?? CompanyRole.Accountant;
    if (actorRole !== CompanyRole.Owner && actorRole !== CompanyRole.Manager) {
      throw new ForbiddenException('Only Owner or Manager can approve a bill');
    }

    try {
      await this.journalEntriesService.approve(
        current.bill.journal_entry_id,
        userId,
        {},
        actorRole,
      );
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1_1_E.md E-25] Owner override; does not flip match_status.
   */
  async overrideMatchBlock(
    id: string,
    dto: OverrideMatchBlockDto,
    userId: string,
    role?: CompanyRole,
  ): Promise<BillWithLines> {
    await this.findOne(id);
    if (role !== CompanyRole.Owner) {
      throw new ForbiddenException('Only Owner can override a match payment block');
    }

    try {
      await this.billsRepository.updateHeader(id, {
        payment_match_override_reason: dto.reason.trim(),
        payment_match_overridden_by: userId,
        payment_match_overridden_at: new Date().toISOString(),
      });
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /** [feature-spec-1_1_E.md E-13] */
  async void(id: string, dto: VoidBillDto, createdBy: string): Promise<BillVoidResult> {
    const current = await this.findOne(id);
    const allowed = new Set([
      BillStatus.Issued,
      BillStatus.PartiallyPaid,
      BillStatus.PendingApproval,
      BillStatus.Disputed,
    ]);
    if (!allowed.has(current.bill.status)) {
      throw new BadRequestException(
        `Cannot void bill from status ${current.bill.status}`,
      );
    }

    try {
      const { ledger_reversal_status } = await this.billsRepository.voidBill(
        id,
        dto.void_reason.trim(),
        createdBy,
      );
      const withLines = await this.findOne(id);
      return { ...withLines, ledger_reversal_status };
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /** [feature-spec-1_1_E.md E-7] */
  async schedule(id: string, dto: ScheduleBillDto): Promise<BillWithLines> {
    const current = await this.findOne(id);
    if (
      current.bill.status !== BillStatus.Issued &&
      current.bill.status !== BillStatus.PartiallyPaid
    ) {
      throw new BadRequestException(
        `Cannot schedule payment on bill with status ${current.bill.status}`,
      );
    }

    try {
      await this.billsRepository.updateHeader(id, {
        scheduled_payment_date: dto.scheduled_payment_date,
      });
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * [feature-spec-1_1_E.md §4.1] Clearing dispute returns issued / partially_paid
   * from amount_paid. Does not reverse a posted JE.
   */
  async dispute(id: string, dto: DisputeBillDto): Promise<BillWithLines> {
    const current = await this.findOne(id);

    if (dto.disputed) {
      if (
        current.bill.status !== BillStatus.Issued &&
        current.bill.status !== BillStatus.PartiallyPaid
      ) {
        throw new BadRequestException(
          `Cannot dispute bill from status ${current.bill.status}`,
        );
      }
      try {
        await this.billsRepository.updateHeader(id, { status: BillStatus.Disputed });
        return this.findOne(id);
      } catch (error) {
        handleDatabaseError(error);
      }
    }

    if (current.bill.status !== BillStatus.Disputed) {
      throw new BadRequestException(
        `Cannot clear dispute on bill with status ${current.bill.status}`,
      );
    }

    const restored =
      Number(current.bill.amount_paid) > 0 ? BillStatus.PartiallyPaid : BillStatus.Issued;
    try {
      await this.billsRepository.updateHeader(id, { status: restored });
      return this.findOne(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createLine(billId: string, dto: CreateBillLineDto): Promise<BillLine> {
    const current = await this.findOne(billId);
    this.assertMutable(current.bill, 'add lines to');

    try {
      return await this.billsRepository.insertLine(billId, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async updateLine(billId: string, lineId: string, dto: UpdateBillLineDto): Promise<BillLine> {
    const current = await this.findOne(billId);
    this.assertMutable(current.bill, 'update lines on');
    await this.requireLineOnParent(billId, lineId);

    try {
      return await this.billsRepository.updateLine(lineId, dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async deleteLine(billId: string, lineId: string): Promise<void> {
    const current = await this.findOne(billId);
    this.assertMutable(current.bill, 'delete lines from');
    await this.requireLineOnParent(billId, lineId);

    try {
      await this.billsRepository.deleteLine(lineId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private assertMutable(bill: Bill, action: string): void {
    if (!MUTABLE_STATUSES.has(bill.status)) {
      throw new BadRequestException(
        `Cannot ${action} bill ${bill.bill_number ?? bill.id} — status is ${bill.status}`,
      );
    }
  }

  private async requireLineOnParent(billId: string, lineId: string): Promise<BillLine> {
    const line = await this.billsRepository.findLineById(lineId);
    if (!line || line.bill_id !== billId) {
      throw new NotFoundException(`Bill line ${lineId} not found on bill ${billId}`);
    }
    return line;
  }

  private assertCustomDaysWhenRequired(
    paymentTerms: PaymentTermsType | undefined,
    customDays: number | null | undefined,
  ): void {
    if (paymentTerms === PaymentTermsType.Custom && (customDays == null || customDays < 1)) {
      throw new BadRequestException('custom_days is required when payment_terms is custom');
    }
  }

  private async assertSupplierUsable(supplierId: string, companyId: string): Promise<void> {
    const supplierCompanyId = await this.billsRepository.findSupplierCompanyId(supplierId);
    if (!supplierCompanyId) throw new NotFoundException(`Supplier ${supplierId} not found`);
    if (supplierCompanyId !== companyId) {
      throw new BadRequestException(`Supplier ${supplierId} does not belong to this company`);
    }

    const isActive = await this.billsRepository.findSupplierActive(supplierId);
    if (!isActive) {
      throw new BadRequestException(
        `Supplier ${supplierId} is inactive — cannot create or assign bills`,
      );
    }
  }
}
