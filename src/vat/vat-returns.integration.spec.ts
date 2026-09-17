import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.local') });

import { Test, TestingModule } from '@nestjs/testing';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { DatabaseModule } from '../database/database.module';
import { SupabaseService } from '../database/supabase.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentTermsType } from '../invoices/common/enums/payment-terms-type.enum';
import { INTEGRATION_USER_ID, mintFreshIntegrationCompany } from '../test/integration-company.setup';
import { VatModule } from './vat.module';
import { VatService } from './vat.service';
import { CompanyRole } from '../common/enums/company-role.enum';

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

(hasSupabase ? describe : describe.skip)('Module F VAT returns (feature-spec-1_1_F.md)', () => {
  jest.setTimeout(180_000);

  let invoicesService: InvoicesService;
  let customersService: CustomersService;
  let vatService: VatService;
  let supabase: SupabaseService;
  let companyId = '';

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule, CustomersModule, InvoicesModule, VatModule],
    }).compile();
    invoicesService = module.get(InvoicesService);
    customersService = module.get(CustomersService);
    vatService = module.get(VatService);
    supabase = module.get(SupabaseService);
    companyId = await mintFreshIntegrationCompany(supabase, 'VAT F');
  }, 120000);

  it('calculates output VAT and due date on the 28th after the quarter [F-7 / F-21]', async () => {
    const customer = await customersService.create({
      company_id: companyId,
      customer_name: 'VAT customer',
      trn: `2${Date.now()}`.slice(0, 15),
    });
    const draft = await invoicesService.create(
      {
        company_id: companyId,
        customer_id: customer.id,
        invoice_date: '2026-01-15',
        payment_terms: PaymentTermsType.Net30,
        lines: [
          {
            line_number: 1,
            description: 'Standard-rated supply',
            quantity: 1,
            unit_price: 1000,
            vat_rate: 5,
          },
        ],
      },
      INTEGRATION_USER_ID,
    );
    await invoicesService.issue(draft.invoice.id);

    const result = (await vatService.calculate(
      { company_id: companyId, period_start: '2026-01-01' },
      INTEGRATION_USER_ID,
    )) as { output_vat: string | number; net_vat: string | number; payment_due_date: string; status: string };

    expect(Number(result.output_vat)).toBe(50);
    expect(Number(result.net_vat)).toBe(50);
    expect(result.payment_due_date).toBe('2026-04-28');
    expect(result.status).toBe('calculated');
  });

  it('files after review/approve then blocks Issue in the filed period [F-8 / F-24]', async () => {
    const result = (await vatService.calculate(
      { company_id: companyId, period_start: '2026-01-01' },
      INTEGRATION_USER_ID,
    )) as { id: string };

    await vatService.submitForReview(result.id, INTEGRATION_USER_ID, CompanyRole.Owner);
    await vatService.approve(result.id, INTEGRATION_USER_ID, CompanyRole.Owner);
    const filed = (await vatService.file(result.id, INTEGRATION_USER_ID, CompanyRole.Owner)) as {
      status: string;
    };
    expect(filed.status).toBe('filed');

    const customer = await customersService.create({
      company_id: companyId,
      customer_name: 'Post-file customer',
      trn: `3${Date.now()}`.slice(0, 15),
    });
    const draft = await invoicesService.create(
      {
        company_id: companyId,
        customer_id: customer.id,
        invoice_date: '2026-02-01',
        payment_terms: PaymentTermsType.Net30,
        lines: [
          {
            line_number: 1,
            description: 'After file',
            quantity: 1,
            unit_price: 100,
            vat_rate: 5,
          },
        ],
      },
      INTEGRATION_USER_ID,
    );
    await expect(invoicesService.issue(draft.invoice.id)).rejects.toThrow(/VAT_PERIOD_FILED|filed/i);
  });

  it('rejects Accountant file [F-8 / F-10]', async () => {
    await expect(
      vatService.file('00000000-0000-0000-0000-000000000001', INTEGRATION_USER_ID, CompanyRole.Accountant),
    ).rejects.toThrow(/Only Owner/);
  });
});
