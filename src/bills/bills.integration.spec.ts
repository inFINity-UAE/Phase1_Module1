import { config } from 'dotenv';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

config({ path: resolve(__dirname, '../../.env.local') });

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CompanyRole } from '../common/enums/company-role.enum';
import { JournalEntryStatus } from '../common/enums/journal-entry-status.enum';
import { JournalEntryType } from '../common/enums/journal-entry-type.enum';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { getAccountIdByNumber, APPROVAL_THRESHOLD } from '../e2e/e2e-company.setup';
import { PaymentTermsType } from '../invoices/common/enums/payment-terms-type.enum';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { PaymentMethodType } from '../payments/common/enums/payment-method-type.enum';
import { GoodsReceiptsModule } from '../goods-receipts/goods-receipts.module';
import { GoodsReceiptsService } from '../goods-receipts/goods-receipts.service';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { SupplierPaymentsModule } from '../supplier-payments/supplier-payments.module';
import { SupplierPaymentsService } from '../supplier-payments/supplier-payments.service';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { SuppliersService } from '../suppliers/suppliers.service';
import {
  INTEGRATION_USER_ID,
  mintFreshIntegrationCompany,
} from '../test/integration-company.setup';
import { BillsModule } from './bills.module';
import { BillsService } from './bills.service';
import { BillMatchStatus } from './common/enums/bill-match-status.enum';
import { BillStatus } from './common/enums/bill-status.enum';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

const USER_ID = INTEGRATION_USER_ID;
const BILL_DATE = '2026-06-01';

(hasSupabase ? describe : describe.skip)(
  'Module 1.1.E AP (feature-spec-1_1_E.md)',
  () => {
    jest.setTimeout(180_000);

    let billsService: BillsService;
    let suppliersService: SuppliersService;
    let purchaseOrdersService: PurchaseOrdersService;
    let goodsReceiptsService: GoodsReceiptsService;
    let supplierPaymentsService: SupplierPaymentsService;
    let journalEntriesService: JournalEntriesService;
    let supabase: SupabaseService;
    let companyId = '';
    let supplierId = '';
    let account5000 = '';
    let account2000 = '';
    let account1400 = '';
    let account1350 = '';
    let account5060 = '';
    let account2020 = '';
    let account1020 = '';

    beforeAll(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          DatabaseModule,
          SuppliersModule,
          PurchaseOrdersModule,
          GoodsReceiptsModule,
          BillsModule,
          SupplierPaymentsModule,
          JournalEntriesModule,
        ],
      }).compile();

      billsService = module.get(BillsService);
      suppliersService = module.get(SuppliersService);
      purchaseOrdersService = module.get(PurchaseOrdersService);
      goodsReceiptsService = module.get(GoodsReceiptsService);
      supplierPaymentsService = module.get(SupplierPaymentsService);
      journalEntriesService = module.get(JournalEntriesService);
      supabase = module.get(SupabaseService);

      companyId = await mintFreshIntegrationCompany(supabase, 'Module E AP');
      const supplier = await suppliersService.create({
        company_id: companyId,
        supplier_name: 'Module E supplier',
      });
      supplierId = supplier.id;
      account5000 = await getAccountIdByNumber(supabase, companyId, '5000');
      account2000 = await getAccountIdByNumber(supabase, companyId, '2000');
      account1400 = await getAccountIdByNumber(supabase, companyId, '1400');
      account1350 = await getAccountIdByNumber(supabase, companyId, '1350');
      account5060 = await getAccountIdByNumber(supabase, companyId, '5060');
      account2020 = await getAccountIdByNumber(supabase, companyId, '2020');
      account1020 = await getAccountIdByNumber(supabase, companyId, '1020');
    }, 120_000);

    async function journalLines(entryId: string) {
      const { data, error } = await supabase.client
        .from('journal_lines')
        .select('account_id, debit, credit')
        .eq('journal_entry_id', entryId)
        .order('line_number');
      if (error) {
        throw error;
      }
      return data ?? [];
    }

    it('§4.2 no-PO issue posts Dr expense/1400/Cr 5060/2000', async () => {
      const created = await billsService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          bill_date: BILL_DATE,
          payment_terms: PaymentTermsType.Net30,
          lines: [
            {
              line_number: 1,
              description: 'Purchases',
              quantity: 1,
              unit_price: 1000,
              discount_percent: 10,
              vat_rate: 5,
              account_id: account5000,
            },
          ],
        },
        USER_ID,
      );
      expect(created.bill.status).toBe(BillStatus.Draft);
      expect(Number(created.bill.grand_total)).toBe(945);

      const issued = await billsService.issue(created.bill.id, USER_ID, CompanyRole.Owner);
      expect(issued.bill.status).toBe(BillStatus.Issued);
      expect(issued.bill.match_status).toBe(BillMatchStatus.NoPo);
      expect(issued.bill.bill_number).toMatch(/^BILL-2026-\d{4}$/);
      expect(issued.bill.due_date).toBe('2026-07-01');
      expect(issued.bill.journal_entry_id).toBeTruthy();

      const { data: entry } = await supabase.client
        .from('journal_entries')
        .select('entry_type, status')
        .eq('id', issued.bill.journal_entry_id!)
        .single();
      expect(entry!.entry_type).toBe(JournalEntryType.PurchaseInvoice);
      expect(entry!.status).toBe(JournalEntryStatus.Posted);

      const lines = await journalLines(issued.bill.journal_entry_id!);
      const byAccount = Object.fromEntries(
        lines.map((l) => [l.account_id, { debit: Number(l.debit), credit: Number(l.credit) }]),
      );
      expect(byAccount[account5000]).toEqual({ debit: 1000, credit: 0 });
      expect(byAccount[account1400]).toEqual({ debit: 45, credit: 0 });
      expect(byAccount[account5060]).toEqual({ debit: 0, credit: 100 });
      expect(byAccount[account2000]).toEqual({ debit: 0, credit: 945 });
    });

    it('E-28 Accountant at threshold stays pending_approval; Owner posts immediately', async () => {
      const pending = await billsService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          bill_date: BILL_DATE,
          lines: [
            {
              line_number: 1,
              description: 'At threshold',
              quantity: 1,
              unit_price: APPROVAL_THRESHOLD,
              vat_rate: 0,
              account_id: account5000,
            },
          ],
        },
        USER_ID,
      );
      const issuedPending = await billsService.issue(
        pending.bill.id,
        USER_ID,
        CompanyRole.Accountant,
      );
      expect(issuedPending.bill.status).toBe(BillStatus.PendingApproval);
      const { data: pendingJe } = await supabase.client
        .from('journal_entries')
        .select('status')
        .eq('id', issuedPending.bill.journal_entry_id!)
        .single();
      expect(pendingJe!.status).toBe(JournalEntryStatus.PendingApproval);

      const approved = await billsService.approve(
        pending.bill.id,
        USER_ID,
        CompanyRole.Owner,
      );
      expect(approved.bill.status).toBe(BillStatus.Issued);

      const ownerBill = await billsService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          bill_date: BILL_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Owner bypass',
              quantity: 1,
              unit_price: APPROVAL_THRESHOLD,
              vat_rate: 0,
              account_id: account5000,
            },
          ],
        },
        USER_ID,
      );
      const ownerIssued = await billsService.issue(
        ownerBill.bill.id,
        USER_ID,
        CompanyRole.Owner,
      );
      expect(ownerIssued.bill.status).toBe(BillStatus.Issued);
    });

    it('E-26 qty 0% / price 2% match; over-qty mismatches', async () => {
      const po = await purchaseOrdersService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          po_date: BILL_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Widget',
              quantity: 10,
              unit_price: 100,
              account_id: account5000,
            },
          ],
        },
        USER_ID,
      );
      const poLineId = po.lines[0].id;
      await goodsReceiptsService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          purchase_order_id: po.purchase_order.id,
          receipt_date: '2026-06-03',
          lines: [{ purchase_order_line_id: poLineId, quantity_received: 10 }],
        },
        USER_ID,
      );

      const matchedBill = await billsService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          purchase_order_id: po.purchase_order.id,
          bill_date: BILL_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Widget',
              quantity: 10,
              unit_price: 101.5,
              vat_rate: 0,
              account_id: account5000,
              purchase_order_line_id: poLineId,
            },
          ],
        },
        USER_ID,
      );
      const matched = await billsService.match(matchedBill.bill.id);
      expect(matched.bill.match_status).toBe(BillMatchStatus.Matched);

      const mismatchBill = await billsService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          purchase_order_id: po.purchase_order.id,
          bill_date: BILL_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Widget over qty',
              quantity: 11,
              unit_price: 100,
              vat_rate: 0,
              account_id: account5000,
              purchase_order_line_id: poLineId,
            },
          ],
        },
        USER_ID,
      );
      const mismatched = await billsService.match(mismatchBill.bill.id);
      expect(mismatched.bill.match_status).toBe(BillMatchStatus.QuantityMismatch);
    });

    it('E-25 match block: Accountant cannot override; Owner override pays without flipping match_status', async () => {
      const po = await purchaseOrdersService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          po_date: BILL_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Blocked widget',
              quantity: 1,
              unit_price: 200,
              account_id: account5000,
            },
          ],
        },
        USER_ID,
      );
      const poLineId = po.lines[0].id;
      await goodsReceiptsService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          purchase_order_id: po.purchase_order.id,
          receipt_date: '2026-06-03',
          lines: [{ purchase_order_line_id: poLineId, quantity_received: 1 }],
        },
        USER_ID,
      );

      const created = await billsService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          purchase_order_id: po.purchase_order.id,
          bill_date: BILL_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Blocked widget',
              quantity: 2,
              unit_price: 200,
              vat_rate: 0,
              account_id: account5000,
              purchase_order_line_id: poLineId,
            },
          ],
        },
        USER_ID,
      );
      const issued = await billsService.issue(created.bill.id, USER_ID, CompanyRole.Owner);
      expect(issued.bill.status).toBe(BillStatus.Issued);
      expect(issued.bill.match_status).toBe(BillMatchStatus.QuantityMismatch);

      await expect(
        billsService.overrideMatchBlock(
          issued.bill.id,
          { reason: 'Accountant try' },
          USER_ID,
          CompanyRole.Accountant,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await expect(
        supplierPaymentsService.createPayment(
          {
            company_id: companyId,
            supplier_id: supplierId,
            payment_date: '2026-06-15',
            amount: 400,
            payment_method: PaymentMethodType.BankTransfer,
            applications: [{ bill_id: issued.bill.id, applied_amount: 400 }],
          },
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      const overridden = await billsService.overrideMatchBlock(
        issued.bill.id,
        { reason: 'Owner authorised mismatch payment' },
        USER_ID,
        CompanyRole.Owner,
      );
      expect(overridden.bill.match_status).toBe(BillMatchStatus.QuantityMismatch);
      expect(overridden.bill.payment_match_override_reason).toBe(
        'Owner authorised mismatch payment',
      );

      const paid = await supplierPaymentsService.createPayment(
        {
          company_id: companyId,
          supplier_id: supplierId,
          payment_date: '2026-06-15',
          amount: 400,
          payment_method: PaymentMethodType.BankTransfer,
          applications: [{ bill_id: issued.bill.id, applied_amount: 400 }],
        },
        USER_ID,
      );
      const posted = await supplierPaymentsService.postPayment(paid.payment.id, USER_ID);
      expect(posted.payment.journal_entry_id).toBeTruthy();
      const after = await billsService.findOne(issued.bill.id);
      expect(after.bill.status).toBe(BillStatus.Paid);
    });

    it('E-13 void posted bill reverses the JE; pending_approval void rejects the unposted JE', async () => {
      const postedBill = await billsService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          bill_date: BILL_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Void posted',
              quantity: 1,
              unit_price: 50,
              vat_rate: 0,
              account_id: account5000,
            },
          ],
        },
        USER_ID,
      );
      const issued = await billsService.issue(postedBill.bill.id, USER_ID, CompanyRole.Owner);
      const voided = await billsService.void(
        issued.bill.id,
        { void_reason: 'Duplicate supplier invoice' },
        USER_ID,
      );
      expect(voided.bill.status).toBe(BillStatus.Void);
      expect(voided.ledger_reversal_status).toBe('reversed');
      const { data: original } = await supabase.client
        .from('journal_entries')
        .select('status, reversed_by_entry_id')
        .eq('id', issued.bill.journal_entry_id!)
        .single();
      expect(original!.status).toBe(JournalEntryStatus.Reversed);
      expect(original!.reversed_by_entry_id).toBeTruthy();

      const pendingBill = await billsService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          bill_date: BILL_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Void pending',
              quantity: 1,
              unit_price: APPROVAL_THRESHOLD,
              vat_rate: 0,
              account_id: account5000,
            },
          ],
        },
        USER_ID,
      );
      const pending = await billsService.issue(
        pendingBill.bill.id,
        USER_ID,
        CompanyRole.Accountant,
      );
      expect(pending.bill.status).toBe(BillStatus.PendingApproval);
      const voidPending = await billsService.void(
        pending.bill.id,
        { void_reason: 'Withdrawn before approval' },
        USER_ID,
      );
      expect(voidPending.bill.status).toBe(BillStatus.Void);
      expect(voidPending.ledger_reversal_status).toBe('skipped_no_posting');
      const { data: pendingJe } = await supabase.client
        .from('journal_entries')
        .select('status')
        .eq('id', pending.bill.journal_entry_id!)
        .single();
      expect(pendingJe!.status).toBe(JournalEntryStatus.Rejected);
    });

    it('rejects a supplier that belongs to another company_id', async () => {
      await expect(
        billsService.create(
          {
            company_id: randomUUID(),
            supplier_id: supplierId,
            bill_date: BILL_DATE,
            lines: [
              {
                line_number: 1,
                description: 'Cross-tenant',
                quantity: 1,
                unit_price: 1,
                vat_rate: 0,
                account_id: account5000,
              },
            ],
          },
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('§4.5 unapplied payment posts Dr 1350; later application reclass Dr 2000 / Cr 1350', async () => {
      const bill = await billsService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          bill_date: BILL_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Advance target',
              quantity: 1,
              unit_price: 250,
              vat_rate: 0,
              account_id: account5000,
            },
          ],
        },
        USER_ID,
      );
      const issued = await billsService.issue(bill.bill.id, USER_ID, CompanyRole.Owner);

      const advance = await supplierPaymentsService.createPayment(
        {
          company_id: companyId,
          supplier_id: supplierId,
          payment_date: '2026-06-10',
          amount: 250,
          payment_method: PaymentMethodType.Cash,
        },
        USER_ID,
      );
      expect(Number(advance.payment.unapplied_amount)).toBe(250);
      const postedAdvance = await supplierPaymentsService.postPayment(
        advance.payment.id,
        USER_ID,
      );
      const { data: advEntry } = await supabase.client
        .from('journal_entries')
        .select('entry_type')
        .eq('id', postedAdvance.payment.journal_entry_id!)
        .single();
      expect(advEntry!.entry_type).toBe(JournalEntryType.SupplierAdvance);
      const advLines = await journalLines(postedAdvance.payment.journal_entry_id!);
      expect(advLines.some((l) => l.account_id === account1350 && Number(l.debit) === 250)).toBe(
        true,
      );

      const application = await supplierPaymentsService.createApplication(
        postedAdvance.payment.id,
        { bill_id: issued.bill.id, applied_amount: 250 },
        USER_ID,
      );
      const reclass = await supplierPaymentsService.postAdvanceApplication(
        postedAdvance.payment.id,
        application.id,
        USER_ID,
      );
      const { data: reclassEntry } = await supabase.client
        .from('journal_entries')
        .select('entry_type')
        .eq('id', reclass.journal_entry_id)
        .single();
      expect(reclassEntry!.entry_type).toBe(JournalEntryType.SupplierAdvanceApplication);
      const reclassLines = await journalLines(reclass.journal_entry_id);
      expect(
        reclassLines.some((l) => l.account_id === account2000 && Number(l.debit) === 250),
      ).toBe(true);
      expect(
        reclassLines.some((l) => l.account_id === account1350 && Number(l.credit) === 250),
      ).toBe(true);
    });

    it('E-21 GRNI accrual credits 2020 for unmatched receipts; E-5 run skips blocked bills', async () => {
      const po = await purchaseOrdersService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          po_date: BILL_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Unbilled receipt',
              quantity: 4,
              unit_price: 25,
              account_id: account5000,
            },
          ],
        },
        USER_ID,
      );
      await goodsReceiptsService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          purchase_order_id: po.purchase_order.id,
          receipt_date: '2026-06-20',
          lines: [
            {
              purchase_order_line_id: po.lines[0].id,
              quantity_received: 4,
            },
          ],
        },
        USER_ID,
      );

      const accrual = (await journalEntriesService.accrueUnbilledReceipts(
        { company_id: companyId, period_end_date: '2026-06-29' },
        USER_ID,
      )) as { journal_entry_id?: string; accrual_amount?: number };
      expect(Number(accrual.accrual_amount ?? 0)).toBeGreaterThan(0);
      if (accrual.journal_entry_id) {
        const { data: grniEntry } = await supabase.client
          .from('journal_entries')
          .select('entry_type')
          .eq('id', accrual.journal_entry_id)
          .single();
        expect(grniEntry!.entry_type).toBe(JournalEntryType.GrniAccrual);
        const grniLines = await journalLines(accrual.journal_entry_id);
        expect(
          grniLines.some((l) => l.account_id === account2020 && Number(l.credit) > 0),
        ).toBe(true);
      }

      const blocked = await billsService.create(
        {
          company_id: companyId,
          supplier_id: supplierId,
          purchase_order_id: po.purchase_order.id,
          bill_date: BILL_DATE,
          lines: [
            {
              line_number: 1,
              description: 'Run skip',
              quantity: 5,
              unit_price: 25,
              vat_rate: 0,
              account_id: account5000,
              purchase_order_line_id: po.lines[0].id,
            },
          ],
        },
        USER_ID,
      );
      const issuedBlocked = await billsService.issue(
        blocked.bill.id,
        USER_ID,
        CompanyRole.Owner,
      );
      expect(issuedBlocked.bill.match_status).not.toBe(BillMatchStatus.Matched);

      const run = await supplierPaymentsService.createRun(
        {
          company_id: companyId,
          run_date: '2026-06-25',
          payment_method: PaymentMethodType.BankTransfer,
          bank_account_id: account1020,
          items: [
            {
              bill_id: issuedBlocked.bill.id,
              supplier_id: supplierId,
              amount_to_pay: Number(issuedBlocked.bill.grand_total),
            },
          ],
        },
        USER_ID,
      );
      await supplierPaymentsService.approveRun(run.run.id, USER_ID, CompanyRole.Owner);
      const executed = (await supplierPaymentsService.executeRun(run.run.id, USER_ID)) as {
        payments?: unknown[];
        skipped?: unknown[];
      };
      expect(executed.skipped?.length ?? 0).toBeGreaterThan(0);
      expect(executed.payments ?? []).toHaveLength(0);
    });
  },
);
