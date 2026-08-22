/** Single-account row from public.v_trial_balance — [Rules §3.1]. */
export class AccountTrialBalance {
  account_id!: string;
  total_debit!: number;
  total_credit!: number;
  balance!: number;
}
