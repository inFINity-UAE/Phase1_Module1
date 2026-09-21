/** [feature-spec-1.1.H.md H2-4] One (month, sub_category) expense bucket. */
export type ExpenseAnalysisRow = {
  month_start: string;
  sub_category: string;
  amount: number;
  mom_delta: number;
};
