import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BillsService } from '../bills/bills.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { BillExtractionRepository, ExtractionRow } from './bill-extraction.repository';
import {
  classifyDuplicate,
  decidePromotion,
  ExtractionSnapshot,
  SnapshotLine,
} from './extraction-rules';
import { originsForSnapshot, snapshotFromVeryfi } from './veryfi-snapshot';

export interface PromotionOverrides {
  supplierId?: string | null;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  accountId?: string | null;
  lines?: SnapshotLine[];
  actorId: string;
  confirm?: boolean;
}

@Injectable()
export class DocumentPromotionService {
  constructor(
    private readonly extractions: BillExtractionRepository,
    private readonly suppliers: SuppliersService,
    private readonly bills: BillsService,
  ) {}

  async ingestWebhook(veryfiDocumentId: string, body: unknown): Promise<ExtractionRow> {
    const row = await this.extractions.findByVeryfiId(veryfiDocumentId);
    if (!row) throw new NotFoundException('VERYFI_DOCUMENT_NOT_TRACKED');
    if (row.extracted_snapshot.review?.status === 'rejected') return row;

    const snapshot = snapshotFromVeryfi(body);
    snapshot.uploaded_by = row.extracted_snapshot.uploaded_by ?? null;
    snapshot.ocr_score = snapshot.ocr_score;
    const origin = { ...row.field_origin, ...originsForSnapshot(snapshot) };
    const updated = await this.extractions.updateSnapshot(row.id, snapshot, origin);
    return this.promote(updated, { actorId: snapshot.uploaded_by ?? '', confirm: false });
  }

  async promote(row: ExtractionRow, overrides: PromotionOverrides): Promise<ExtractionRow> {
    if (row.extracted_snapshot.review?.status === 'rejected') {
      throw new BadRequestException('EXTRACTION_REJECTED');
    }
    const snapshot = this.applyOverrides(row.extracted_snapshot, overrides);
    const origin = { ...row.field_origin };
    this.markEdited(origin, overrides);

    if (row.bill_id) {
      if (!overrides.confirm) {
        snapshot.review = row.extracted_snapshot.review;
        return this.extractions.updateSnapshot(row.id, snapshot, origin, row.bill_id);
      }
      snapshot.review = {
        ...snapshot.review,
        status: 'cleared',
        soft_flags: [],
        hard_blocks: [],
      };
      if (overrides.accountId) {
        await this.applyAccount(row.bill_id, overrides.accountId);
      }
      return this.extractions.updateSnapshot(row.id, snapshot, origin, row.bill_id);
    }

    const supplierId = await this.resolveSupplier(row.company_id, snapshot, overrides);
    const rateDate =
      snapshot.invoice_date && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.invoice_date)
        ? snapshot.invoice_date
        : new Date().toISOString().slice(0, 10);
    const standardRate = await this.extractions.standardRate(rateDate);
    const existing = await this.extractions.billsForDuplicate(row.company_id);
    const duplicate = classifyDuplicate({
      supplierId,
      invoiceNumber: snapshot.invoice_number,
      totalAmount: snapshot.total_amount,
      billDate: snapshot.invoice_date,
      existing,
    });
    const learnedAccountId = supplierId
      ? await this.extractions.learnedAccountId(row.company_id, supplierId)
      : null;
    const decision = decidePromotion({
      snapshot,
      standardRate,
      supplierId,
      duplicate,
      learnedAccountId,
      accountOverride: overrides.accountId ?? null,
    });

    snapshot.review = {
      status: 'open',
      hard_blocks: decision.hardBlocks,
      soft_flags: decision.softFlags,
      rejection_reason: null,
    };

    if (!decision.createBill || !decision.supplierId || !decision.billDate) {
      return this.extractions.updateSnapshot(row.id, snapshot, origin);
    }

    const createdBy = overrides.actorId || snapshot.uploaded_by;
    if (!createdBy) {
      snapshot.review.hard_blocks = [...decision.hardBlocks, 'uploader_unknown'];
      return this.extractions.updateSnapshot(row.id, snapshot, origin);
    }

    const bill = await this.bills.create(
      {
        company_id: row.company_id,
        supplier_id: decision.supplierId,
        supplier_invoice_number: decision.supplierInvoiceNumber,
        bill_date: decision.billDate,
        lines: decision.lines.map((line, index) => ({
          line_number: index + 1,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          vat_rate: line.vatRate,
          vat_category: line.vatCategory,
          account_id: line.accountId,
        })),
      },
      createdBy,
    );

    const confirmed = overrides.confirm === true;
    snapshot.review = {
      status: confirmed || decision.softFlags.length === 0 ? 'cleared' : 'open',
      hard_blocks: [],
      soft_flags: confirmed ? [] : decision.softFlags,
      rejection_reason: null,
    };
    return this.extractions.updateSnapshot(row.id, snapshot, origin, bill.bill.id);
  }

  async reject(row: ExtractionRow, reason: string): Promise<ExtractionRow> {
    const snapshot = row.extracted_snapshot;
    snapshot.review = {
      status: 'rejected',
      hard_blocks: snapshot.review?.hard_blocks ?? [],
      soft_flags: snapshot.review?.soft_flags ?? [],
      rejection_reason: reason,
    };
    return this.extractions.updateSnapshot(row.id, snapshot, row.field_origin, row.bill_id);
  }

  private applyOverrides(snapshot: ExtractionSnapshot, overrides: PromotionOverrides): ExtractionSnapshot {
    const next: ExtractionSnapshot = {
      ...snapshot,
      lines: overrides.lines ?? snapshot.lines.map((line) => ({ ...line })),
      review: { ...snapshot.review },
    };
    if (overrides.supplierName !== undefined) next.vendor_name = overrides.supplierName;
    if (overrides.invoiceNumber !== undefined) next.invoice_number = overrides.invoiceNumber;
    if (overrides.invoiceDate !== undefined) next.invoice_date = overrides.invoiceDate;
    return next;
  }

  private markEdited(origin: Record<string, string>, overrides: PromotionOverrides): void {
    if (overrides.supplierName !== undefined || overrides.supplierId) origin.vendor_name = 'human_edited';
    if (overrides.invoiceNumber !== undefined) origin.invoice_number = 'human_edited';
    if (overrides.invoiceDate !== undefined) origin.invoice_date = 'human_edited';
    if (overrides.lines) origin.lines = 'human_edited';
    if (overrides.accountId) origin.account_id = 'human_edited';
  }

  private async resolveSupplier(
    companyId: string,
    snapshot: ExtractionSnapshot,
    overrides: PromotionOverrides,
  ): Promise<string | null> {
    if (overrides.supplierId) {
      const supplier = await this.suppliers.findOne(overrides.supplierId);
      if (supplier.company_id !== companyId || !supplier.is_active) return null;
      return supplier.id;
    }
    const name = (overrides.supplierName ?? snapshot.vendor_name)?.trim();
    if (!name) return null;
    const suppliers = await this.suppliers.findAll(companyId);
    const matches = suppliers.filter(
      (supplier) => supplier.is_active && supplier.supplier_name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (matches.length === 1) return matches[0].id;
    if (matches.length === 0 && overrides.supplierName) {
      const created = await this.suppliers.create({ company_id: companyId, supplier_name: name });
      return created.id;
    }
    return null;
  }

  private async applyAccount(billId: string, accountId: string): Promise<void> {
    const bill = await this.bills.findOne(billId);
    for (const line of bill.lines) {
      await this.bills.updateLine(billId, line.id, { account_id: accountId });
    }
  }
}

export function isReviewQueueRow(row: ExtractionRow): boolean {
  const review = row.extracted_snapshot.review;
  if (!review || review.status === 'rejected' || review.status === 'cleared') return false;
  if (row.bill_id == null) return true;
  return (review.soft_flags ?? []).length > 0;
}
