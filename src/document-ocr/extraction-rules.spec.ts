import { VatCategory } from '../common/enums/vat-category.enum';
import {
  classifyDuplicate,
  decidePromotion,
  deriveLineVat,
  emptySnapshot,
  ExtractionSnapshot,
} from './extraction-rules';

function readySnapshot(overrides: Partial<ExtractionSnapshot> = {}): ExtractionSnapshot {
  return {
    ...emptySnapshot(),
    vendor_name: 'Al Noor',
    invoice_number: 'INV-1',
    invoice_date: '2026-01-15',
    net_amount: 100,
    vat_amount: 5,
    total_amount: 105,
    lines: [
      {
        description: 'Paper',
        quantity: 1,
        unit_price: 100,
        line_net: 100,
        line_vat: 5,
        line_total: 105,
      },
    ],
    ...overrides,
  };
}

describe('B1 extraction rules (feature-spec-1_1_B.md §0.3.2 / §3)', () => {
  it('snaps a per-line ratio to the looked-up standard rate', () => {
    expect(deriveLineVat(5, 100, 5)).toEqual({
      ok: true,
      vatRate: 5,
      vatCategory: VatCategory.StandardRated,
    });
  });

  it('uses the passed standard rate instead of a hardcoded 5', () => {
    expect(deriveLineVat(10, 100, 10)).toEqual({
      ok: true,
      vatRate: 10,
      vatCategory: VatCategory.StandardRated,
    });
    expect(deriveLineVat(5, 100, 10).ok).toBe(false);
  });

  it('sets vat 0 and a null category when the ratio is zero', () => {
    expect(deriveLineVat(0, 100, 5)).toEqual({ ok: true, vatRate: 0, vatCategory: null });
  });

  it('does not snap 4.87 to a nearby rate', () => {
    expect(deriveLineVat(4.87, 100, 5)).toEqual({ ok: false });
  });

  it('creates a bill for a zero-VAT document whose total equals the lines', () => {
    const decision = decidePromotion({
      snapshot: readySnapshot({
        vat_amount: null,
        net_amount: 100,
        total_amount: 100,
        lines: [
          {
            description: 'Paper',
            quantity: 1,
            unit_price: 100,
            line_net: 100,
            line_vat: null,
            line_total: 100,
          },
        ],
      }),
      standardRate: 5,
      supplierId: 'sup-1',
      duplicate: { certain: false, likely: false },
      learnedAccountId: 'acc-1',
      accountOverride: null,
    });
    expect(decision.createBill).toBe(true);
    expect(decision.lines[0]).toMatchObject({ vatRate: 0, vatCategory: null });
    expect(decision.hardBlocks).toEqual([]);
  });

  it('applies a header VAT amount only when it snaps to the standard rate', () => {
    const standard = decidePromotion({
      snapshot: readySnapshot({
        lines: [
          {
            description: 'Paper',
            quantity: 2,
            unit_price: 50,
            line_net: 100,
            line_vat: null,
            line_total: 100,
          },
        ],
      }),
      standardRate: 5,
      supplierId: 'sup-1',
      duplicate: { certain: false, likely: false },
      learnedAccountId: 'acc-1',
      accountOverride: null,
    });
    expect(standard.createBill).toBe(true);
    expect(standard.lines[0].vatCategory).toBe(VatCategory.StandardRated);

    const mixed = decidePromotion({
      snapshot: readySnapshot({
        vat_amount: 4.87,
        total_amount: 104.87,
        lines: [
          {
            description: 'Paper',
            quantity: 1,
            unit_price: 100,
            line_net: 100,
            line_vat: null,
            line_total: 100,
          },
        ],
      }),
      standardRate: 5,
      supplierId: 'sup-1',
      duplicate: { certain: false, likely: false },
      learnedAccountId: 'acc-1',
      accountOverride: null,
    });
    expect(mixed.createBill).toBe(false);
    expect(mixed.hardBlocks).toContain('vat_not_derived');
  });

  it('hard-blocks an unresolved vendor or a bad date and still soft-flags duplicates', () => {
    const blocked = decidePromotion({
      snapshot: readySnapshot({ invoice_date: 'not-a-date' }),
      standardRate: 5,
      supplierId: null,
      duplicate: { certain: true, likely: false },
      learnedAccountId: null,
      accountOverride: null,
    });
    expect(blocked.createBill).toBe(false);
    expect(blocked.hardBlocks).toEqual(expect.arrayContaining(['vendor_unresolved', 'bill_date_invalid']));
    expect(blocked.lines).toEqual([]);
  });

  it('creates the bill and records soft flags for a total mismatch, duplicate, and missing category', () => {
    const decision = decidePromotion({
      snapshot: readySnapshot({ total_amount: 110 }),
      standardRate: 5,
      supplierId: 'sup-1',
      duplicate: { certain: false, likely: true },
      learnedAccountId: null,
      accountOverride: null,
    });
    expect(decision.createBill).toBe(true);
    expect(decision.softFlags).toEqual([
      'extracted_total_mismatch',
      'duplicate_likely',
      'category_unresolved',
    ]);
  });

  it('treats an exact invoice number as certain and ±1 AED within 3 days as likely', () => {
    const existing = [
      {
        supplierId: 'sup-1',
        supplierInvoiceNumber: 'INV-1',
        grandTotal: 100,
        billDate: '2026-01-16',
        voided: false,
      },
    ];
    expect(
      classifyDuplicate({
        supplierId: 'sup-1',
        invoiceNumber: 'INV-1',
        totalAmount: 200,
        billDate: '2026-02-01',
        existing,
      }).certain,
    ).toBe(true);
    expect(
      classifyDuplicate({
        supplierId: 'sup-1',
        invoiceNumber: 'OTHER',
        totalAmount: 101,
        billDate: '2026-01-18',
        existing,
      }).likely,
    ).toBe(true);
    expect(
      classifyDuplicate({
        supplierId: 'sup-1',
        invoiceNumber: 'OTHER',
        totalAmount: 103,
        billDate: '2026-01-16',
        existing,
      }).likely,
    ).toBe(false);
  });
});
