/** [feature-spec-1.1.H.md H2-6] Totals already computed by H1 / D / E reports. */
export type ExecutiveSummaryReport = {
  period_start: string;
  period_end: string;
  as_of_date: string;
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
  is_balanced: boolean;
  net_profit: number;
  total_ar_outstanding: number;
  total_ap_outstanding: number;
  drilldown: {
    balance_sheet: { as_of_date: string };
    profit_and_loss: { period_start: string; period_end: string };
    aged_receivables: { as_of_date: string };
    aged_payables: { as_of_date: string };
  };
};
