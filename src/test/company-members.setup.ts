import { SupabaseService } from '../database/supabase.service';
import { CompanyRole } from '../common/enums/company-role.enum';
import { ActorContext } from '../auth/actor-context';

const TEST_USER_PASSWORD = 'infinity-test-user-password';

/** Ensure auth.users row exists — company_members.user_id FK requires it. */
export async function ensureAuthUser(
  supabase: SupabaseService,
  userId: string,
  email: string,
): Promise<void> {
  const { data, error } = await supabase.client.auth.admin.getUserById(userId);
  if (!error && data.user) {
    return;
  }

  const { error: createError } = await supabase.client.auth.admin.createUser({
    id: userId,
    email,
    password: TEST_USER_PASSWORD,
    email_confirm: true,
  });

  if (createError) {
    // Race or prior partial seed — re-check before failing the suite.
    const { data: retry, error: retryError } = await supabase.client.auth.admin.getUserById(userId);
    if (retryError || !retry.user) {
      throw createError;
    }
  }
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
