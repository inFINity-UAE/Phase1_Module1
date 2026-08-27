import { BadRequestException } from '@nestjs/common';

/**
 * [feature-spec.md decision #35] Shared account_id checks for journal_lines
 * writes that accept client-supplied accounts (createLine + insert_journal_entry_draft).
 */
export type JournalLineAccountRow = {
  id: string;
  company_id: string;
  is_active: boolean;
  account_number?: string | null;
};

export function assertAccountsUsableForCompany(
  companyId: string,
  accountIds: string[],
  accounts: JournalLineAccountRow[],
): void {
  const uniqueIds = [...new Set(accountIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return;
  }

  const byId = new Map(accounts.map((row) => [row.id, row]));

  for (const accountId of uniqueIds) {
    const account = byId.get(accountId);
    if (!account) {
      throw new BadRequestException(
        `Account ${accountId} was not found — cannot post journal lines against a missing account`,
      );
    }
    if (account.company_id !== companyId) {
      throw new BadRequestException(
        `Account ${account.account_number ?? accountId} belongs to a different company than the journal entry`,
      );
    }
    if (!account.is_active) {
      throw new BadRequestException(
        `Account ${account.account_number ?? accountId} is inactive (is_active = false) and cannot be used on journal lines`,
      );
    }
  }
}
