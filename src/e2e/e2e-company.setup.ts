import { SupabaseService } from '../database/supabase.service';
import { PeriodStatus } from '../common/enums/period-status.enum';
import { JournalEntriesRepository } from '../journal-entries/journal-entries.repository';

export const E2E_COMPANY_ID = '00000000-0000-0000-0000-00000000e2e1';
export const E2E_OWNER_ID = '00000000-0000-0000-0000-000000000003';
export const E2E_ACCOUNTANT_ID = '00000000-0000-0000-0000-000000000004';
export const DEMO_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
export const APPROVAL_THRESHOLD = 5000;

const MONTHS = [
  ['01', 31],
  ['02', 28],
  ['03', 31],
  ['04', 30],
  ['05', 31],
  ['06', 30],
  ['07', 31],
  ['08', 31],
  ['09', 30],
  ['10', 31],
  ['11', 30],
  ['12', 31],
] as const;

export async function resolveCleanFiscalYear(
  repository: JournalEntriesRepository,
  companyId: string,
): Promise<number> {
  for (let year = 2105; year <= 2200; year += 1) {
    const hasOpening = await repository.hasOpeningBalanceForFiscalYear(companyId, year);
    const hasYearEnd = await repository.hasYearEndClosingForFiscalYear(companyId, year);
    if (!hasOpening && !hasYearEnd) {
      return year;
    }
  }

  throw new Error(`No unused fiscal year found for E2E company ${companyId}`);
}

export async function ensureCompanyWithCoa(
  supabase: SupabaseService,
  companyId: string,
  legalName: string,
): Promise<void> {
  await supabase.client.from('companies').upsert({
    id: companyId,
    legal_name: legalName,
    base_currency: 'AED',
    is_free_zone_entity: false,
    fiscal_year_start_month: 1,
  });

  await supabase.client.from('company_settings').upsert({
    company_id: companyId,
    journal_approval_threshold: APPROVAL_THRESHOLD,
    approval_threshold_currency: 'AED',
    default_period_length: 'monthly',
    allow_period_reopen: true,
  });

  const { count, error: countError } = await supabase.client
    .from('accounts')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);

  if (countError) {
    throw countError;
  }

  if ((count ?? 0) >= 80) {
    return;
  }

  const { data: demoAccounts, error: demoError } = await supabase.client
    .from('accounts')
    .select(
      'account_number, account_name, category, sub_category, normal_balance, parent_account_id, depth, is_system_account, is_active, description',
    )
    .eq('company_id', DEMO_COMPANY_ID)
    .order('depth', { ascending: true })
    .order('account_number', { ascending: true });

  if (demoError || !demoAccounts?.length) {
    throw demoError ?? new Error('Demo COA not found — run Stage 1 seed first');
  }

  const { data: demoWithParents, error: parentError } = await supabase.client
    .from('accounts')
    .select('id, account_number, parent_account_id')
    .eq('company_id', DEMO_COMPANY_ID);

  if (parentError || !demoWithParents) {
    throw parentError ?? new Error('Demo COA parent lookup failed');
  }

  const demoIdToNumber = new Map(
    demoWithParents.map((row) => [row.id as string, row.account_number as string]),
  );
  const numberToCompanyId = new Map<string, string>();

  for (const account of demoAccounts) {
    const { data: existingAccount, error: existingError } = await supabase.client
      .from('accounts')
      .select('id')
      .eq('company_id', companyId)
      .eq('account_number', account.account_number)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existingAccount) {
      numberToCompanyId.set(account.account_number as string, existingAccount.id as string);
      continue;
    }

    const parentNumber = account.parent_account_id
      ? demoIdToNumber.get(account.parent_account_id as string)
      : null;
    const parentId = parentNumber ? numberToCompanyId.get(parentNumber) ?? null : null;

    const { data: inserted, error: insertError } = await supabase.client
      .from('accounts')
      .insert({
        company_id: companyId,
        account_number: account.account_number,
        account_name: account.account_name,
        category: account.category,
        sub_category: account.sub_category,
        normal_balance: account.normal_balance,
        parent_account_id: parentId,
        depth: account.depth,
        is_system_account: account.is_system_account,
        is_active: account.is_active,
        description: account.description,
      })
      .select('id, account_number')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: racedAccount, error: racedError } = await supabase.client
          .from('accounts')
          .select('id, account_number')
          .eq('company_id', companyId)
          .eq('account_number', account.account_number)
          .single();

        if (racedError || !racedAccount) {
          throw racedError ?? insertError;
        }

        numberToCompanyId.set(racedAccount.account_number as string, racedAccount.id as string);
        continue;
      }

      throw insertError;
    }

    if (!inserted) {
      throw new Error(`Failed to seed account ${account.account_number}`);
    }

    numberToCompanyId.set(inserted.account_number as string, inserted.id as string);
  }
}

export async function ensureE2eCompanyReady(supabase: SupabaseService): Promise<void> {
  await ensureCompanyWithCoa(
    supabase,
    E2E_COMPANY_ID,
    'E2E Lifecycle Test Company',
  );
}

export async function ensureFiscalYearPeriods(
  supabase: SupabaseService,
  companyId: string,
  fiscalYear: number,
): Promise<Map<string, string>> {
  const periodIds = new Map<string, string>();

  for (const [month, lastDay] of MONTHS) {
    const periodStart = `${fiscalYear}-${month}-01`;
    const periodEnd = `${fiscalYear}-${month}-${lastDay}`;

    const { data: existing, error: existingError } = await supabase.client
      .from('accounting_periods')
      .select('id')
      .eq('company_id', companyId)
      .eq('period_start', periodStart)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      periodIds.set(periodStart, existing.id as string);
      continue;
    }

    const { data: inserted, error: insertError } = await supabase.client
      .from('accounting_periods')
      .insert({
        company_id: companyId,
        period_start: periodStart,
        period_end: periodEnd,
        fiscal_year: fiscalYear,
        status: PeriodStatus.Open,
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      throw insertError ?? new Error(`Failed to create period ${periodStart}`);
    }

    periodIds.set(periodStart, inserted.id as string);
  }

  return periodIds;
}

export async function getAccountIdByNumber(
  supabase: SupabaseService,
  companyId: string,
  accountNumber: string,
): Promise<string> {
  const { data, error } = await supabase.client
    .from('accounts')
    .select('id')
    .eq('company_id', companyId)
    .eq('account_number', accountNumber)
    .single();

  if (error || !data) {
    throw error ?? new Error(`Account ${accountNumber} not found for company ${companyId}`);
  }

  return data.id as string;
}
