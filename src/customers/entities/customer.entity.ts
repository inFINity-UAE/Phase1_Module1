/** Row shape for `customers` — [feature-spec-1.1.C.md §1.1]. */
export class Customer {
  id!: string;
  company_id!: string;
  customer_name!: string;
  trn!: string | null;
  email!: string | null;
  phone!: string | null;
  billing_address!: string | null;
  default_payment_terms!: string | null;
  is_active!: boolean;
  created_at!: string;
  updated_at!: string;
}
