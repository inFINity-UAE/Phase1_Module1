import { BadRequestException } from '@nestjs/common';

/**
 * [feature-spec.md decisions #35 / #39 / #44] Shared account_id checks for
 * client-supplied accounts on journal_lines writes (createLine,
 * insert_journal_entry_draft, create_opening_balance_entry, updateLine when
 * account_id changes) and recurring_journal_template_lines
 * (template create lines, insertLine, updateLine when account_id changes).
 * Not category-aware — opening-balance income/expense rejection is RPC-only (#57).
 */
export type JournalLineAccountRow = {
  id: string;
  company_id: string;
  is_active: boolean;
  account_number?: string | null;
  category?: string;
};

/**
 * [feature-spec.md §4.8 / decision #35 company-match half; feature-spec-1_1_H.md #5]
 * Report filter paths: account must exist and belong to company_id.
 * Does NOT require is_active — historical GL may include inactive accounts.
 */
export function assertAccountBelongsToCompany(
  companyId: string,
  accountId: string,
  account:
    | Pick<JournalLineAccountRow, 'id' | 'company_id' | 'account_number'>
    | null
    | undefined,
): void {
  if (!account) {
    throw new BadRequestException(
      `Account ${accountId} was not found — cannot filter a report against a missing account`,
    );
  }
  if (account.company_id !== companyId) {
    throw new BadRequestException(
      `Account ${account.account_number ?? accountId} belongs to a different company than the report request`,
    );
  }
}

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

/**
 * [feature-spec.md decision #57] Opening-balance call site only — extends #35/#39 with
 * income/expense rejection. Mirrors create_opening_balance_entry RPC; app layer fails
 * fast, RPC is the DB backstop when service_role bypasses Nest (§5.1).
 */
export function assertOpeningBalanceAccountsUsable(
  companyId: string,
  accountIds: string[],
  accounts: JournalLineAccountRow[],
): void {
  assertAccountsUsableForCompany(companyId, accountIds, accounts);

  const byId = new Map(accounts.map((row) => [row.id, row]));
  for (const accountId of [...new Set(accountIds.filter(Boolean))]) {
    const account = byId.get(accountId);
    if (
      account &&
      (account.category === 'income' || account.category === 'expense')
    ) {
      throw new BadRequestException(
        'Opening balance lines may only use asset, liability, or equity accounts — ' +
          'income and expense accounts are not allowed',
      );
    }
  }
}
