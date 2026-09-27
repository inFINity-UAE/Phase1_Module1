import { emptySnapshot, ExtractionSnapshot, SnapshotLine } from './extraction-rules';

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function lineFrom(raw: Record<string, unknown>): SnapshotLine {
  const quantity = num(raw.quantity);
  const unitPrice = num(raw.unit_price ?? raw.price);
  const lineVat = num(raw.line_vat ?? raw.tax ?? raw.tax_amount);
  const lineTotal = num(raw.line_total ?? raw.total);
  const explicitNet = num(raw.line_net ?? raw.net);
  const lineNet =
    explicitNet ??
    (quantity != null && unitPrice != null ? Math.round(quantity * unitPrice * 100) / 100 : null);
  return {
    description: text(raw.description),
    quantity,
    unit_price: unitPrice,
    line_net: lineNet,
    line_vat: lineVat,
    line_total: lineTotal,
  };
}

/**
 * [feature-spec-1_1_B.md §2] Map a Veryfi document payload into the snapshot.
 * Unknown extra keys are ignored so B3 can send the same shape later.
 */
export function snapshotFromVeryfi(body: unknown): ExtractionSnapshot {
  const snapshot = emptySnapshot();
  const record = asRecord(body);
  if (!record) return snapshot;

  const vendor = asRecord(record.vendor);
  snapshot.vendor_name = text(vendor?.name) ?? text(record.vendor_name);
  snapshot.invoice_number = text(record.invoice_number);
  snapshot.invoice_date = text(record.date) ?? text(record.invoice_date);
  snapshot.vat_amount = num(record.tax ?? record.vat ?? record.vat_amount);
  snapshot.net_amount = num(record.subtotal ?? record.net ?? record.net_amount);
  snapshot.total_amount = num(record.total ?? record.total_amount);

  const meta = asRecord(record.meta);
  snapshot.ocr_score = num(meta?.ocr_score ?? record.ocr_score);

  const rawLines = record.line_items ?? record.lines;
  if (Array.isArray(rawLines)) {
    snapshot.lines = rawLines.map((line) => lineFrom(asRecord(line) ?? {}));
  }
  return snapshot;
}

export function originsForSnapshot(snapshot: ExtractionSnapshot): Record<string, 'extracted'> {
  const origin: Record<string, 'extracted'> = {};
  const mark = (key: string, value: unknown) => {
    if (value != null && value !== '') origin[key] = 'extracted';
  };
  mark('vendor_name', snapshot.vendor_name);
  mark('invoice_number', snapshot.invoice_number);
  mark('invoice_date', snapshot.invoice_date);
  mark('vat_amount', snapshot.vat_amount);
  mark('net_amount', snapshot.net_amount);
  mark('total_amount', snapshot.total_amount);
  snapshot.lines.forEach((line, index) => {
    mark(`lines.${index}.description`, line.description);
    mark(`lines.${index}.quantity`, line.quantity);
    mark(`lines.${index}.unit_price`, line.unit_price);
    mark(`lines.${index}.line_vat`, line.line_vat);
    mark(`lines.${index}.line_total`, line.line_total);
  });
  return origin;
}
