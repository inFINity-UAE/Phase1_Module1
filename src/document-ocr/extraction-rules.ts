import { VatCategory } from '../common/enums/vat-category.enum';

/** [feature-spec-1_1_B.md §0.3.2] Half-up to numeric(5,2) / numeric(18,2). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface SnapshotLine {
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_net: number | null;
  line_vat: number | null;
  line_total: number | null;
}

export interface ExtractionSnapshot {
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  lines: SnapshotLine[];
  vat_amount: number | null;
  net_amount: number | null;
  total_amount: number | null;
  ocr_score: number | null;
  uploaded_by: string | null;
  review: {
    status: 'open' | 'rejected' | 'cleared';
    hard_blocks: string[];
    soft_flags: string[];
    rejection_reason: string | null;
  };
}

export interface PreparedLine {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  vatCategory: VatCategory | null;
  accountId: string | null;
}

export interface PromotionDecision {
  createBill: boolean;
  hardBlocks: string[];
  softFlags: string[];
  supplierId: string | null;
  billDate: string | null;
  supplierInvoiceNumber: string | null;
  lines: PreparedLine[];
}

export function emptySnapshot(): ExtractionSnapshot {
  return {
    vendor_name: null,
    invoice_number: null,
    invoice_date: null,
    lines: [],
    vat_amount: null,
    net_amount: null,
    total_amount: null,
    ocr_score: null,
    uploaded_by: null,
    review: { status: 'open', hard_blocks: [], soft_flags: [], rejection_reason: null },
  };
}

function isIsoDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

type LineVat = { ok: true; vatRate: number; vatCategory: VatCategory | null } | { ok: false };

/** [feature-spec-1_1_B.md §0.3.2] */
export function deriveLineVat(
  lineVat: number | null,
  lineNet: number | null,
  standardRate: number,
): LineVat {
  if (lineVat == null || lineNet == null) return { ok: false };
  if (lineNet === 0) {
    return lineVat === 0
      ? { ok: true, vatRate: 0, vatCategory: null }
      : { ok: false };
  }
  const derived = round2((lineVat / lineNet) * 100);
  if (derived === round2(standardRate)) {
    return { ok: true, vatRate: round2(standardRate), vatCategory: VatCategory.StandardRated };
  }
  if (derived === 0) return { ok: true, vatRate: 0, vatCategory: null };
  return { ok: false };
}

function lineNetOf(line: SnapshotLine): number | null {
  if (line.line_net != null) return line.line_net;
  if (line.quantity != null && line.unit_price != null) return round2(line.quantity * line.unit_price);
  return null;
}

function headerRatioIsZero(snapshot: ExtractionSnapshot): boolean {
  const net = snapshot.net_amount ?? snapshot.lines.reduce((total, line) => total + (lineNetOf(line) ?? 0), 0);
  const vat = snapshot.vat_amount;
  if (vat == null || net === 0) return false;
  return round2((vat / net) * 100) === 0;
}

function headerRatioSnapsToStandard(snapshot: ExtractionSnapshot, standardRate: number): boolean {
  const net = snapshot.net_amount;
  const vat = snapshot.vat_amount;
  if (net == null || vat == null || net === 0) return false;
  return round2((vat / net) * 100) === round2(standardRate);
}

function nullVatMatchesLineSum(snapshot: ExtractionSnapshot): boolean {
  if (snapshot.vat_amount != null) return false;
  if (snapshot.total_amount == null) return false;
  const sum = round2(
    snapshot.lines.reduce((total, line) => total + (lineNetOf(line) ?? line.line_total ?? 0), 0),
  );
  return round2(snapshot.total_amount) === sum;
}

function totalsDisagree(snapshot: ExtractionSnapshot): boolean {
  if (snapshot.vat_amount == null || snapshot.net_amount == null || snapshot.total_amount == null) {
    return false;
  }
  return round2(snapshot.net_amount + snapshot.vat_amount) !== round2(snapshot.total_amount);
}

export interface DuplicateHit {
  certain: boolean;
  likely: boolean;
}

/** [feature-spec-1_1_B.md §5.1] */
export function classifyDuplicate(input: {
  supplierId: string | null;
  invoiceNumber: string | null;
  totalAmount: number | null;
  billDate: string | null;
  existing: Array<{
    supplierId: string;
    supplierInvoiceNumber: string | null;
    grandTotal: number;
    billDate: string;
    voided: boolean;
  }>;
}): DuplicateHit {
  const hit: DuplicateHit = { certain: false, likely: false };
  if (!input.supplierId) return hit;
  const peers = input.existing.filter((row) => row.supplierId === input.supplierId && !row.voided);
  const invoice = input.invoiceNumber?.trim() ?? '';
  if (invoice) {
    hit.certain = peers.some((row) => (row.supplierInvoiceNumber ?? '').trim() === invoice);
  }
  if (input.totalAmount != null && isIsoDate(input.billDate)) {
    const date = Date.parse(`${input.billDate}T00:00:00Z`);
    hit.likely = peers.some((row) => {
      const peerDate = Date.parse(`${row.billDate}T00:00:00Z`);
      const days = Math.abs(date - peerDate) / 86_400_000;
      return days <= 3 && Math.abs(round2(row.grandTotal) - round2(input.totalAmount as number)) <= 1;
    });
  }
  return hit;
}

/**
 * [feature-spec-1_1_B.md §3 / §0.3.2 / §5.1 / §5.2]
 * Hard blocks prevent the bills row. Soft flags do not.
 * ocr_score is stored by the caller and is not a gate (B-3.6).
 */
export function decidePromotion(input: {
  snapshot: ExtractionSnapshot;
  standardRate: number;
  supplierId: string | null;
  duplicate: DuplicateHit;
  learnedAccountId: string | null;
  accountOverride: string | null;
}): PromotionDecision {
  const hardBlocks: string[] = [];
  const snapshot = input.snapshot;
  if (!input.supplierId) hardBlocks.push('vendor_unresolved');
  if (!isIsoDate(snapshot.invoice_date)) hardBlocks.push('bill_date_invalid');

  const structural: PreparedLine[] = [];
  if (snapshot.lines.length === 0) hardBlocks.push('lines_missing');
  for (const line of snapshot.lines) {
    const description = line.description?.trim() ?? '';
    if (!description) hardBlocks.push('line_description_missing');
    if (line.quantity == null || line.quantity <= 0) hardBlocks.push('line_quantity_invalid');
    if (line.unit_price == null || line.unit_price < 0) hardBlocks.push('line_unit_price_invalid');
    structural.push({
      description,
      quantity: line.quantity ?? 0,
      unitPrice: line.unit_price ?? 0,
      vatRate: 0,
      vatCategory: null,
      accountId: input.accountOverride ?? input.learnedAccountId,
    });
  }

  const perLineVat = snapshot.lines.some((line) => line.line_vat != null);
  const vatByLine: LineVat[] = [];
  if (perLineVat) {
    for (const line of snapshot.lines) {
      vatByLine.push(deriveLineVat(line.line_vat, lineNetOf(line), input.standardRate));
    }
  } else if (nullVatMatchesLineSum(snapshot) || headerRatioIsZero(snapshot)) {
    for (const _line of snapshot.lines) vatByLine.push({ ok: true, vatRate: 0, vatCategory: null });
  } else if (headerRatioSnapsToStandard(snapshot, input.standardRate)) {
    const rate = round2(input.standardRate);
    for (const _line of snapshot.lines) {
      vatByLine.push({ ok: true, vatRate: rate, vatCategory: VatCategory.StandardRated });
    }
  } else {
    hardBlocks.push('vat_not_derived');
  }

  if (vatByLine.some((line) => !line.ok)) hardBlocks.push('vat_not_derived');

  const lines = structural.map((line, index) => {
    const vat = vatByLine[index];
    if (!vat || !vat.ok) return line;
    return { ...line, vatRate: vat.vatRate, vatCategory: vat.vatCategory };
  });

  const softFlags: string[] = [];
  if (totalsDisagree(snapshot)) softFlags.push('extracted_total_mismatch');
  if (input.duplicate.certain) softFlags.push('duplicate_certain');
  if (input.duplicate.likely) softFlags.push('duplicate_likely');
  if (!input.accountOverride && !input.learnedAccountId) softFlags.push('category_unresolved');

  const uniqueBlocks = [...new Set(hardBlocks)];
  return {
    createBill: uniqueBlocks.length === 0,
    hardBlocks: uniqueBlocks,
    softFlags,
    supplierId: input.supplierId,
    billDate: isIsoDate(snapshot.invoice_date) ? snapshot.invoice_date : null,
    supplierInvoiceNumber: snapshot.invoice_number?.trim() || null,
    lines: uniqueBlocks.length === 0 ? lines : [],
  };
}
