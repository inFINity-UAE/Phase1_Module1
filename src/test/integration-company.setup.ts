import { SupabaseService } from '../database/supabase.service';
import {
  ensureCompanyWithCoa,
  ensureFiscalYearPeriods,
  E2E_ACCOUNTANT_ID,
} from '../e2e/e2e-company.setup';
import { CompanyRole } from '../common/enums/company-role.enum';
import { ensureCompanyMember, testUserEmail } from './company-members.setup';

/** Isolated companies for Supabase integration suites — never share demo ...0001. */
export const POST_INTEGRATION_COMPANY_ID = '00000000-0000-0000-0000-00000000b001';
export const YEAR_END_INTEGRATION_COMPANY_ID = '00000000-0000-0000-0000-00000000b002';
export const AUDIT_LOG_INTEGRATION_COMPANY_ID = '00000000-0000-0000-0000-00000000b003';
export const REVERSE_INTEGRATION_COMPANY_ID = '00000000-0000-0000-0000-00000000b004';
export const APPROVAL_RBAC_INTEGRATION_COMPANY_ID = '00000000-0000-0000-0000-00000000b005';
export const INTEGRATION_USER_ID = '00000000-0000-0000-0000-000000000002';
/** Non-Owner/non-Manager member for RBAC negative tests on integration company b005. */
export const INTEGRATION_ACCOUNTANT_ID = E2E_ACCOUNTANT_ID;

const INTEGRATION_FISCAL_YEAR = 2026;

async function ensureIntegrationCompanyMember(
  supabase: SupabaseService,
  companyId: string,
): Promise<void> {
  await ensureCompanyMember(
    supabase,
    companyId,
    INTEGRATION_USER_ID,
    CompanyRole.Owner,
    testUserEmail(INTEGRATION_USER_ID),
  );
}

export async function ensurePostIntegrationCompanyReady(
  supabase: SupabaseService,
): Promise<void> {
  await ensureCompanyWithCoa(
    supabase,
    POST_INTEGRATION_COMPANY_ID,
    'Journal Post Integration Test Company',
  );
  await ensureFiscalYearPeriods(supabase, POST_INTEGRATION_COMPANY_ID, INTEGRATION_FISCAL_YEAR);
  await ensureIntegrationCompanyMember(supabase, POST_INTEGRATION_COMPANY_ID);
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
  await ensureIntegrationCompanyMember(supabase, YEAR_END_INTEGRATION_COMPANY_ID);
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
  await ensureIntegrationCompanyMember(supabase, AUDIT_LOG_INTEGRATION_COMPANY_ID);
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
  await ensureIntegrationCompanyMember(supabase, REVERSE_INTEGRATION_COMPANY_ID);
}

export async function ensureApprovalRbacIntegrationCompanyReady(
  supabase: SupabaseService,
): Promise<void> {
  await ensureCompanyWithCoa(
    supabase,
    APPROVAL_RBAC_INTEGRATION_COMPANY_ID,
    'Approval RBAC Integration Test Company',
  );
  await ensureFiscalYearPeriods(
    supabase,
    APPROVAL_RBAC_INTEGRATION_COMPANY_ID,
    INTEGRATION_FISCAL_YEAR,
  );
  await ensureCompanyMember(
    supabase,
    APPROVAL_RBAC_INTEGRATION_COMPANY_ID,
    INTEGRATION_USER_ID,
    CompanyRole.Owner,
    testUserEmail(INTEGRATION_USER_ID),
  );
  await ensureCompanyMember(
    supabase,
    APPROVAL_RBAC_INTEGRATION_COMPANY_ID,
    INTEGRATION_ACCOUNTANT_ID,
    CompanyRole.Accountant,
    testUserEmail(INTEGRATION_ACCOUNTANT_ID),
  );
}
