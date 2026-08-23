// [company_members.sql §11 / Module 1.6.B] Platform role enum — only Owner and
// Manager are enforced in Module 1.1.A approval workflow; others are forward-compatible.
export enum CompanyRole {
  Owner = 'owner',
  Accountant = 'accountant',
  Manager = 'manager',
  Staff = 'staff',
  Viewer = 'viewer',
  ExternalAccountant = 'external_accountant',
}
