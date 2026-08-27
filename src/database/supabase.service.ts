import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createJwtClockSkewRetryFetch } from './supabase-jwt-clock-skew-retry';

@Injectable()
export class SupabaseService {
  readonly client: SupabaseClient;

  constructor() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;

    if (!url || !secretKey) {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set',
      );
    }

    // [feature-spec.md §5.9 / decision #37] Fetch-level retry covers Auth Admin
    // + PostgREST + any future call on this secret-key client.
    this.client = createClient(url, secretKey, {
      global: { fetch: createJwtClockSkewRetryFetch() },
    });
  }
}
