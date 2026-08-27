import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PostgrestError } from '@supabase/supabase-js';

export function isPostgrestError(error: unknown): error is PostgrestError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error
  );
}

/** Map Postgres/Supabase errors to HTTP exceptions — do not duplicate DB trigger logic. */
export function mapDatabaseError(error: PostgrestError): never {
  const { code, message } = error;

  // PL/pgSQL RAISE EXCEPTION (enforce_account_number_category, max depth, system account, etc.)
  if (code === 'P0001') {
    throw new BadRequestException(message);
  }

  // FK violation — account referenced by journal_lines or child accounts
  if (code === '23503') {
    if (message.includes('journal_lines_account_id_fkey')) {
      throw new ConflictException(
        'Account cannot be deleted because it has journal line transactions.',
      );
    }
    throw new ConflictException(message);
  }

  // Unique violation (duplicate account_number per company, if enforced)
  if (code === '23505') {
    throw new ConflictException(message);
  }

  // Exclusion constraint — [feature-spec.md decision #38] overlapping periods
  if (code === '23P01') {
    if (message.includes('accounting_periods_company_daterange_excl')) {
      throw new ConflictException(
        'Accounting period overlaps an existing period for this company',
      );
    }
    throw new ConflictException(message);
  }

  throw new InternalServerErrorException(message);
}

/** Re-throw mapped HTTP exceptions from repository/database layer. */
export function handleDatabaseError(error: unknown): never {
  if (isPostgrestError(error)) {
    mapDatabaseError(error);
  }
  throw error;
}
