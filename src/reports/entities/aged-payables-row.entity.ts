/** [feature-spec-1_1_E.md §5.2] Aged payables row (supplier or TOTALS). */
export class AgedPayablesRow {
  supplier_id!: string | null;
  supplier_name!: string;
  is_totals!: boolean;
  bucket_current!: number;
  bucket_0_30!: number;
  bucket_31_60!: number;
  bucket_61_90!: number;
  bucket_90_plus!: number;
  total!: number;
}
