import { SupabaseService } from '../database/supabase.service';
import { CompanyRole } from '../common/enums/company-role.enum';
import { ActorContext } from '../auth/actor-context';

const TEST_USER_PASSWORD = 'infinity-test-user-password';

/** Password used by ensureAuthUser — exported for authenticated-client RLS probes. */
export function testUserPassword(): string {
  return TEST_USER_PASSWORD;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? '');
}

function isTransientAuthError(error: unknown): boolean {
  // GoTrue intermittently rejects service-role admin calls with this when
  // edge clocks skew slightly; retrying clears it without weakening auth.
  return /JWT issued at future/i.test(errorMessage(error));
}

async function withAuthRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const maxAttempts = 5;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientAuthError(error) || attempt === maxAttempts) {
        throw error;
      }
      const delayMs = 250 * attempt;
      // eslint-disable-next-line no-console
      console.warn(
        `[auth-retry] ${label} attempt ${attempt}/${maxAttempts} hit transient auth error; retrying in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

/** Ensure auth.users row exists — company_members.user_id FK requires it. */
export async function ensureAuthUser(
  supabase: SupabaseService,
  userId: string,
  email: string,
): Promise<void> {
  await withAuthRetry(`ensureAuthUser(${userId})`, async () => {
    const { data, error } = await supabase.client.auth.admin.getUserById(userId);
    if (!error && data.user) {
      return;
    }
    if (error) {
      if (isTransientAuthError(error)) {
        throw error;
      }
      if (!/User not found|user_not_found/i.test(error.message)) {
        throw error;
      }
    }

    const { error: createError } = await supabase.client.auth.admin.createUser({
      id: userId,
      email,
      password: TEST_USER_PASSWORD,
      email_confirm: true,
    });

    if (createError) {
      if (isTransientAuthError(createError)) {
        throw createError;
      }
      // Race or prior partial seed — re-check before failing the suite.
      const { data: retry, error: retryError } =
        await supabase.client.auth.admin.getUserById(userId);
      if (retryError || !retry.user) {
        throw createError;
      }
    }
  });
}

/** Upsert a company_members row for test/demo/E2E users — [company_members.sql §11]. */
export async function ensureCompanyMember(
  supabase: SupabaseService,
  companyId: string,
  userId: string,
  role: CompanyRole,
  email: string,
): Promise<void> {
  await ensureAuthUser(supabase, userId, email);

  const { error } = await supabase.client.from('company_members').upsert(
    {
      company_id: companyId,
      user_id: userId,
      role,
    },
    { onConflict: 'company_id,user_id' },
  );

  if (error) {
    throw error;
  }
}

export function actor(userId: string, role: CompanyRole): ActorContext {
  return { id: userId, role };
}

export function testUserEmail(userId: string): string {
  return `test-${userId}@infinity.local`;
}
