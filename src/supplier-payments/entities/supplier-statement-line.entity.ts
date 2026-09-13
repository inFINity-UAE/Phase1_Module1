/** Row shape for `supplier_statement_lines` — [feature-spec-1_1_E.md E-11 / E-22]. */
export class SupplierStatementLine {
  id!: string;
  company_id!: string;
  supplier_id!: string;
  statement_date!: string;
  line_date!: string;
  line_type!: string;
  reference!: string | null;
  amount!: number;
  source!: string;
  matched_bill_id!: string | null;
  matched_payment_id!: string | null;
  match_status!: string;
  created_at!: string;
}
