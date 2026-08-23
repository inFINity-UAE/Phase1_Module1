import { SupabaseService } from '../database/supabase.service';
import {
  ensureCompanyWithCoa,
  ensureFiscalYearPeriods,
} from '../e2e/e2e-company.setup';

/** Isolated companies for Supabase integration suites — never share demo ...0001. */
export const POST_INTEGRATION_COMPANY_ID = '00000000-0000-0000-0000-00000000b001';
export const YEAR_END_INTEGRATION_COMPANY_ID = '00000000-0000-0000-0000-00000000b002';
export const AUDIT_LOG_INTEGRATION_COMPANY_ID = '00000000-0000-0000-0000-00000000b003';
export const REVERSE_INTEGRATION_COMPANY_ID = '00000000-0000-0000-0000-00000000b004';
export const INTEGRATION_USER_ID = '00000000-0000-0000-0000-000000000002';

const INTEGRATION_FISCAL_YEAR = 2026;

export async function ensurePostIntegrationCompanyReady(
  supabase: SupabaseService,
): Promise<void> {
  await ensureCompanyWithCoa(
    supabase,
    POST_INTEGRATION_COMPANY_ID,
    'Journal Post Integration Test Company',
  );
  await ensureFiscalYearPeriods(supabase, POST_INTEGRATION_COMPANY_ID, INTEGRATION_FISCAL_YEAR);
}

export async function ensureYearEndIntegrationCompanyReady(
  supabase: SupabaseService,
): Promise<void> {
  await ensureCompanyWithCoa(
    supabase,
    YEAR_END_INTEGRATION_COMPANY_ID,
    'Year-End Closing Integration Test Company',
  );
  await ensureFiscalYearPeriods(
    supabase,
    YEAR_END_INTEGRATION_COMPANY_ID,
    INTEGRATION_FISCAL_YEAR,
  );
}

export async function ensureAuditLogIntegrationCompanyReady(
  supabase: SupabaseService,
): Promise<void> {
  await ensureCompanyWithCoa(
    supabase,
    AUDIT_LOG_INTEGRATION_COMPANY_ID,
    'Audit Log Integration Test Company',
  );
  await ensureFiscalYearPeriods(
    supabase,
    AUDIT_LOG_INTEGRATION_COMPANY_ID,
    INTEGRATION_FISCAL_YEAR,
  );
}

export async function ensureReverseIntegrationCompanyReady(
  supabase: SupabaseService,
): Promise<void> {
  await ensureCompanyWithCoa(
    supabase,
    REVERSE_INTEGRATION_COMPANY_ID,
    'Journal Reverse Integration Test Company',
  );
  await ensureFiscalYearPeriods(
    supabase,
    REVERSE_INTEGRATION_COMPANY_ID,
    INTEGRATION_FISCAL_YEAR,
  );
}
