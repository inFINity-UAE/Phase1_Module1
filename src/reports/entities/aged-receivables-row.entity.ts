/** [feature-spec-1_1_D.md §5.2 / D-5] Aged receivables row (customer or TOTALS). */
export class AgedReceivablesRow {
  customer_id!: string | null;
  customer_name!: string;
  is_totals!: boolean;
  bucket_current!: number;
  bucket_0_30!: number;
  bucket_31_60!: number;
  bucket_61_90!: number;
  bucket_90_plus!: number;
  total!: number;
}
