import { BadRequestException, ConflictException } from '@nestjs/common';
import { mapDatabaseError } from './database-error.mapper';
import { PostgrestError } from '@supabase/supabase-js';

function pgError(code: string, message: string): PostgrestError {
  return { code, message, details: '', hint: '', name: 'PostgrestError' } as PostgrestError;
}

describe('mapDatabaseError', () => {
  it('maps P0001 trigger errors to BadRequestException', () => {
    expect(() =>
      mapDatabaseError(
        pgError(
          'P0001',
          'Account number 2999 does not match category asset (expected prefix 1)',
        ),
      ),
    ).toThrow(BadRequestException);
  });

  it('maps journal_lines FK delete to ConflictException with clean message', () => {
    expect(() =>
      mapDatabaseError(
        pgError(
          '23503',
          'update or delete on table "accounts" violates foreign key constraint "journal_lines_account_id_fkey" on table "journal_lines"',
        ),
      ),
    ).toThrow(ConflictException);

    try {
      mapDatabaseError(
        pgError(
          '23503',
          'update or delete on table "accounts" violates foreign key constraint "journal_lines_account_id_fkey" on table "journal_lines"',
        ),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        'Account cannot be deleted because it has journal line transactions.',
      );
    }
  });

  it('maps period overlap exclusion (23P01) to ConflictException', () => {
    expect(() =>
      mapDatabaseError(
        pgError(
          '23P01',
          'conflicting key value violates exclusion constraint "accounting_periods_company_daterange_excl"',
        ),
      ),
    ).toThrow(ConflictException);

    try {
      mapDatabaseError(
        pgError(
          '23P01',
          'conflicting key value violates exclusion constraint "accounting_periods_company_daterange_excl"',
        ),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        'Accounting period overlaps an existing period for this company',
      );
    }
  });
});
