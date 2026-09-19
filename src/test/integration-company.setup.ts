import { randomUUID } from 'crypto';
import { SupabaseService } from '../database/supabase.service';
import {
  ensureCompanyWithCoa,
  ensureFiscalYearPeriods,
  E2E_ACCOUNTANT_ID,
} from '../e2e/e2e-company.setup';
import { CompanyRole } from '../common/enums/company-role.enum';
import { ensureCompanyMember, testUserEmail } from './company-members.setup';

/**
 * Auth user for integration suites — stable across runs (auth.users), not a company id.
 * Must not collide with DEMO_COMPANY_ID (...0002).
 */
export const INTEGRATION_USER_ID = '00000000-0000-0000-0000-0000000000a2';
/** Non-Owner/non-Manager member for RBAC negative tests. */
export const INTEGRATION_ACCOUNTANT_ID = E2E_ACCOUNTANT_ID;

/** Pre-G year-end callers: skip the G-22 provision gate (Owner + reason). */
export const LEGACY_YE_SKIP_CT = {
  skip_ct_check: true,
  skip_reason: 'legacy year-end caller; CT provision enforced in ct.integration.spec',
} as const;

const INTEGRATION_FISCAL_YEAR = 2026;

/**
 * [feature-spec.md decision #19] Shared mint for every integration suite.
 * Fresh randomUUID per call — never reuse …b001–…b005 or any other fixed company
 * literal. Old fixed companies are retired untouched (no wipe).
 */
export async function mintFreshIntegrationCompany(
  supabase: SupabaseService,
  legalNamePrefix: string,
  options?: {
    fiscalYear?: number;
    withAccountant?: boolean;
  },
): Promise<string> {
  const companyId = randomUUID();
  const fiscalYear = options?.fiscalYear ?? INTEGRATION_FISCAL_YEAR;

  await ensureCompanyWithCoa(supabase, companyId, `${legalNamePrefix} ${companyId}`);
  await ensureFiscalYearPeriods(supabase, companyId, fiscalYear);
  await ensureCompanyMember(
    supabase,
    companyId,
    INTEGRATION_USER_ID,
    CompanyRole.Owner,
    testUserEmail(INTEGRATION_USER_ID),
  );

  if (options?.withAccountant) {
    await ensureCompanyMember(
      supabase,
      companyId,
      INTEGRATION_ACCOUNTANT_ID,
      CompanyRole.Accountant,
      testUserEmail(INTEGRATION_ACCOUNTANT_ID),
    );
  }

  // eslint-disable-next-line no-console
  console.log(`[integration] fresh company_id=${companyId} (${legalNamePrefix})`);
  return companyId;
}

/** @deprecated decision #19 — use mintFreshIntegrationCompany; returns new id each call. */
export async function ensurePostIntegrationCompanyReady(
  supabase: SupabaseService,
): Promise<string> {
  return mintFreshIntegrationCompany(supabase, 'Journal Post Integration');
}

/** @deprecated decision #19 — use mintFreshIntegrationCompany; returns new id each call. */
export async function ensureYearEndIntegrationCompanyReady(
  supabase: SupabaseService,
): Promise<string> {
  return mintFreshIntegrationCompany(supabase, 'Year-End Closing Integration');
}

/** @deprecated decision #19 — use mintFreshIntegrationCompany; returns new id each call. */
export async function ensureAuditLogIntegrationCompanyReady(
  supabase: SupabaseService,
): Promise<string> {
  return mintFreshIntegrationCompany(supabase, 'Audit Log Integration');
}

/** @deprecated decision #19 — use mintFreshIntegrationCompany; returns new id each call. */
export async function ensureReverseIntegrationCompanyReady(
  supabase: SupabaseService,
): Promise<string> {
  return mintFreshIntegrationCompany(supabase, 'Journal Reverse Integration');
}

/** @deprecated decision #19 — use mintFreshIntegrationCompany; returns new id each call. */
export async function ensureApprovalRbacIntegrationCompanyReady(
  supabase: SupabaseService,
): Promise<string> {
  return mintFreshIntegrationCompany(supabase, 'Approval RBAC Integration', {
    withAccountant: true,
  });
}
