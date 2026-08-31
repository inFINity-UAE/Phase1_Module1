/** [feature-spec-1.1.C.md §5 decision #10] Payment terms — due_date derived at Issue. */
export enum PaymentTermsType {
  Net7 = 'net_7',
  Net15 = 'net_15',
  Net30 = 'net_30',
  Net60 = 'net_60',
  Custom = 'custom',
  Cod = 'cod',
}
