/** [feature-spec-1_1_E.md §5.2 / §5.4] Open bill listing from get_bills_due. */
export class BillsDueRow {
  bill_id!: string;
  supplier_id!: string;
  supplier_name!: string;
  bill_number!: string | null;
  due_date!: string | null;
  scheduled_payment_date!: string | null;
  match_status!: string | null;
  outstanding!: number;
}
