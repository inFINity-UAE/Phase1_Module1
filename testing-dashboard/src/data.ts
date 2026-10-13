/**
 * Mock UAE dataset. Account codes/names are taken verbatim from
 * docs/source-of-truth/seed_finalized_coa_demo_company_0002.sql — do not invent codes here.
 */

export const TODAY = '2026-10-13';
export const LEDGER_CUTOFF = '2026-09-30';

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const addDays = (iso: string, days: number) =>
  new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

export const COMPANIES = [
  { id: 'c1', name: 'Horizon Facilities LLC', trn: '100234567800003', jurisdiction: 'Dubai Mainland', fy: 'FY 2026 (Jan–Dec)' },
  { id: 'c2', name: 'Horizon Facilities FZE', trn: '100498812300003', jurisdiction: 'JAFZA Free Zone', fy: 'FY 2026 (Jan–Dec)' },
  { id: 'c3', name: 'Horizon Holdings LLC', trn: '100761234500003', jurisdiction: 'Abu Dhabi Mainland', fy: 'FY 2026 (Jan–Dec)' },
];

export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';
export const accountType = (code: string): AccountType =>
  (['Asset', 'Liability', 'Equity', 'Income', 'Expense'] as const)[Number(code[0]) - 1];

export const ACCOUNTS: Record<string, string> = {
  '1000': 'Petty Cash',
  '1010': 'Cash on Hand',
  '1021': 'Bank Account - Current (AED) - Operations',
  '1022': 'Bank Account - Current (AED) - Payroll Disbursement',
  '1030': 'Bank Account - Savings (AED)',
  '1070': 'Merchant / Payment Gateway Clearing',
  '1100': 'Accounts Receivable - Trade',
  '1110': 'Allowance for Expected Credit Losses (ECL)',
  '1150': 'Related Party Receivables',
  '1300': 'Prepaid Rent',
  '1350': 'Supplier Advances',
  '1400': 'VAT Receivable (Input VAT)',
  '1550': 'Computer Equipment & IT Hardware',
  '1560': 'Motor Vehicles',
  '1640': 'Accumulated Depreciation - Computer Equipment',
  '1650': 'Accumulated Depreciation - Motor Vehicles',
  '2000': 'Accounts Payable - Trade',
  '2010': 'Accrued Expenses',
  '2020': 'Accrued Purchases (Goods Received, Not Invoiced)',
  '2030': 'Related Party Payables',
  '2200': 'VAT Payable (Output VAT)',
  '2300': 'Corporate Tax Payable / Provision',
  '2410': 'Employee End-of-Service Benefits (Gratuity) Provision',
  '2440': 'WPS Salary Transfer Clearing',
  '3000': 'Share Capital',
  '3100': 'Retained Earnings',
  '4000': 'Sales Revenue - Standard Rated (5% VAT)',
  '4010': 'Sales Revenue - Zero Rated (Exports)',
  '4020': 'Sales Revenue - VAT Exempt',
  '4040': 'Service Revenue',
  '4050': 'Sales Returns & Allowances',
  '4060': 'Sales Discounts Given',
  '4500': 'Other Operating Income',
  '4600': 'Interest Income',
  '5000': 'Cost of Goods Sold - Purchases',
  '5100': 'Salaries & Wages Expense',
  '5110': 'Employee Allowances (Housing, Transport)',
  '5120': 'End-of-Service Benefits (Gratuity) Expense',
  '5200': 'Rent Expense - Office/Warehouse',
  '5210': 'DEWA / Utilities (Electricity, Water, AC)',
  '5230': 'Repairs & Maintenance',
  '5400': 'Advertising & Marketing',
  '5500': 'Legal & Professional Fees',
  '5530': 'IT & Software Subscriptions',
  '5540': 'Insurance Expense (Business)',
  '5550': 'Office Supplies',
  '5560': 'Telephone & Communication',
  '5570': 'Travel & Entertainment - Staff',
  '5600': 'Depreciation Expense - Fixed Assets',
  '5640': 'Bad Debt Expense (ECL)',
  '5700': 'Bank Charges & Fees',
  '5710': 'Interest Expense on Loans',
  '5830': 'Corporate Tax Expense',
  '5990': 'Miscellaneous Expense',
};
export const acct = (code: string) => `${code} · ${ACCOUNTS[code] ?? 'Unknown'}`;
export const CASH_ACCOUNTS = ['1000', '1010', '1021', '1022', '1030'];
export const BANK_ACCOUNTS = ['1021', '1022', '1010'];
export const INCOME_ACCOUNTS = ['4000', '4010', '4020', '4040', '4500'];
export const EXPENSE_ACCOUNTS = Object.keys(ACCOUNTS).filter((c) => c[0] === '5');

/** Seeded standard rate on vat_tax_rule_versions is 5.00 (feature-spec-1_1_F). */
export const VAT_CODES = {
  SR: { label: 'Standard 5%', rate: 5 },
  ZR: { label: 'Zero-rated 0%', rate: 0 },
  EX: { label: 'Exempt', rate: 0 },
} as const;
export type VatCode = keyof typeof VAT_CODES;

export type DocLine = { description: string; account: string; qty: number; price: number; vat: VatCode };
export const lineNet = (l: DocLine) => r2(l.qty * l.price);
export const lineVat = (l: DocLine) => r2((lineNet(l) * VAT_CODES[l.vat].rate) / 100);
export const docTotals = (lines: DocLine[]) => {
  const net = r2(lines.reduce((s, l) => s + lineNet(l), 0));
  const vat = r2(lines.reduce((s, l) => s + lineVat(l), 0));
  return { net, vat, gross: r2(net + vat) };
};

export type Emirate = 'Abu Dhabi' | 'Dubai' | 'Sharjah' | 'Ajman' | 'Umm Al Quwain' | 'Ras Al Khaimah' | 'Fujairah';

export type Customer = { id: string; name: string; trn: string; emirate: Emirate; email: string; terms: number };
export const CUSTOMERS: Customer[] = [
  { id: 'cu1', name: 'Al Noor Trading LLC', trn: '100312456700003', emirate: 'Dubai', email: 'ap@alnoor.ae', terms: 30 },
  { id: 'cu2', name: 'Marina Fit-Out LLC', trn: '100427781900003', emirate: 'Dubai', email: 'accounts@marinafitout.ae', terms: 30 },
  { id: 'cu3', name: 'Desert Mall FM LLC', trn: '100538842100003', emirate: 'Abu Dhabi', email: 'finance@desertmall.ae', terms: 30 },
  { id: 'cu4', name: 'Sharjah Ports Services LLC', trn: '100649903200003', emirate: 'Sharjah', email: 'payables@shjports.ae', terms: 30 },
  { id: 'cu5', name: 'RAK Hospitality Group LLC', trn: '100750014300003', emirate: 'Ras Al Khaimah', email: 'ap@rakhospitality.ae', terms: 30 },
  { id: 'cu6', name: 'Ajman Warehousing LLC', trn: '100861125400003', emirate: 'Ajman', email: 'accounts@ajmanwh.ae', terms: 30 },
  { id: 'cu7', name: 'Fujairah Cold Store LLC', trn: '100972236500003', emirate: 'Fujairah', email: 'finance@fujcold.ae', terms: 30 },
  { id: 'cu8', name: 'Gulf Glass Works LLC', trn: '100183347600003', emirate: 'Sharjah', email: 'ap@gulfglass.ae', terms: 30 },
];
export const customer = (id: string) => CUSTOMERS.find((c) => c.id === id)!;

export const CATALOG: { sku: string; name: string; account: string; price: number; vat: VatCode }[] = [
  { sku: 'FM-MNT', name: 'Facilities maintenance — monthly retainer', account: '4040', price: 12500, vat: 'SR' },
  { sku: 'HVAC-SVC', name: 'HVAC preventive servicing visit', account: '4040', price: 1850, vat: 'SR' },
  { sku: 'CLN-DEEP', name: 'Deep cleaning (per sqm)', account: '4040', price: 4.5, vat: 'SR' },
  { sku: 'MAT-SUP', name: 'Materials supply & installation', account: '4000', price: 1000, vat: 'SR' },
  { sku: 'EXP-CNS', name: 'FM consultancy — export of services', account: '4010', price: 9000, vat: 'ZR' },
];

export type InvoiceStage = 'draft' | 'awaiting_approval' | 'issued';
export type Invoice = {
  id: string;
  number: string | null;
  customerId: string;
  issueDate: string;
  dueDate: string;
  stage: InvoiceStage;
  lines: DocLine[];
  paid: number;
  writtenOff?: boolean;
  reminders: number;
  autoDunning?: boolean;
};

const svc = (description: string, net: number, account = '4040'): DocLine[] => [
  { description, account, qty: 1, price: net, vat: 'SR' },
];

export const SEED_INVOICES: Invoice[] = [
  { id: 'i88', number: 'INV-2026-0088', customerId: 'cu2', issueDate: '2026-07-20', dueDate: '2026-08-19', stage: 'issued', lines: svc('Fit-out MEP works — Marina Tower lobby', 86000, '4000'), paid: 0, reminders: 2 },
  { id: 'i91', number: 'INV-2026-0091', customerId: 'cu8', issueDate: '2026-07-28', dueDate: '2026-08-27', stage: 'issued', lines: svc('Glazing maintenance Q3', 17800), paid: 4000, reminders: 1 },
  { id: 'i94', number: 'INV-2026-0094', customerId: 'cu1', issueDate: '2026-08-05', dueDate: '2026-09-04', stage: 'issued', lines: svc('FM retainer — August (warehouse 4)', 24600), paid: 0, reminders: 1 },
  { id: 'i98', number: 'INV-2026-0098', customerId: 'cu5', issueDate: '2026-08-25', dueDate: '2026-09-24', stage: 'issued', lines: svc('HVAC servicing — 9 visits', 16500), paid: 0, reminders: 0 },
  { id: 'i101', number: 'INV-2026-0101', customerId: 'cu3', issueDate: '2026-09-02', dueDate: '2026-10-02', stage: 'issued', lines: svc('Mall FM retainer — September', 38200), paid: 40110, reminders: 0 },
  { id: 'i104', number: 'INV-2026-0104', customerId: 'cu4', issueDate: '2026-09-15', dueDate: '2026-10-15', stage: 'issued', lines: svc('Port terminal deep clean', 32000), paid: 0, reminders: 0 },
  { id: 'i106', number: 'INV-2026-0106', customerId: 'cu6', issueDate: '2026-09-22', dueDate: '2026-10-22', stage: 'issued', lines: svc('Racking repairs & materials', 12800, '4000'), paid: 0, reminders: 0 },
  { id: 'i108', number: 'INV-2026-0108', customerId: 'cu7', issueDate: '2026-09-30', dueDate: '2026-10-30', stage: 'issued', lines: svc('Cold room HVAC call-out', 6100), paid: 0, reminders: 0 },
  { id: 'i110', number: 'INV-2026-0110', customerId: 'cu2', issueDate: '2026-10-06', dueDate: '2026-11-05', stage: 'issued', lines: svc('FM retainer — October', 44500), paid: 0, reminders: 0 },
  { id: 'd1', number: null, customerId: 'cu1', issueDate: '2026-10-12', dueDate: '2026-11-11', stage: 'awaiting_approval', lines: svc('Emergency plumbing — warehouse 2', 9400), paid: 0, reminders: 0 },
  { id: 'd2', number: null, customerId: 'cu5', issueDate: '2026-10-11', dueDate: '2026-11-10', stage: 'awaiting_approval', lines: svc('Kitchen exhaust cleaning', 7200), paid: 0, reminders: 0 },
  { id: 'd3', number: null, customerId: 'cu3', issueDate: '2026-10-13', dueDate: '2026-11-12', stage: 'draft', lines: svc('Mall FM retainer — October', 21750), paid: 0, reminders: 0 },
];

export const QUOTATIONS = [
  { number: 'QT-2026-0042', customerId: 'cu4', date: '2026-10-08', expiry: '2026-11-07', net: 58400, status: 'Sent' },
  { number: 'QT-2026-0041', customerId: 'cu7', date: '2026-10-02', expiry: '2026-11-01', net: 14200, status: 'Accepted' },
  { number: 'QT-2026-0039', customerId: 'cu2', date: '2026-09-21', expiry: '2026-10-21', net: 126000, status: 'Sent' },
  { number: 'QT-2026-0036', customerId: 'cu6', date: '2026-09-04', expiry: '2026-10-04', net: 9800, status: 'Expired' },
  { number: 'QT-2026-0033', customerId: 'cu3', date: '2026-08-18', expiry: '2026-09-17', net: 38200, status: 'Converted' },
];

export const VENDORS = [
  { id: 'v1', name: 'Gulf Cement Co. LLC', trn: '100294455600003', terms: 30, category: 'Materials' },
  { id: 'v2', name: 'Bin Dasmal Building Materials LLC', trn: '100305566700003', terms: 45, category: 'Materials' },
  { id: 'v3', name: 'Emirates Glass Industries LLC', trn: '100416677800003', terms: 30, category: 'Materials' },
  { id: 'v4', name: 'Najm IT Solutions FZ-LLC', trn: '100527788900003', terms: 15, category: 'IT services' },
  { id: 'v5', name: 'Oasis HVAC Spares Trading LLC', trn: '100850011200003', terms: 30, category: 'Spares' },
  { id: 'v6', name: 'Sahara Fleet Services LLC', trn: '100638899000003', terms: 30, category: 'Fleet' },
  { id: 'v7', name: 'Crescent Legal Consultants', trn: '100749900100003', terms: 30, category: 'Professional' },
] as const;
export const vendor = (id: string) => VENDORS.find((v) => v.id === id)!;

export type MatchState = 'matched' | 'variance' | 'missing_grn' | 'no_po';
export type Bill = {
  id: string;
  number: string;
  vendorId: string;
  supplierRef: string;
  billDate: string;
  dueDate: string;
  lines: DocLine[];
  paid: number;
  po: string | null;
  grn: string | null;
  match: MatchState;
  matchNote?: string;
};

const exp = (description: string, net: number, account: string): DocLine[] => [
  { description, account, qty: 1, price: net, vat: 'SR' },
];

export const SEED_BILLS: Bill[] = [
  { id: 'b41', number: 'BILL-2026-0041', vendorId: 'v1', supplierRef: 'GC-2026-441', billDate: '2026-09-14', dueDate: '2026-10-14', lines: exp('Cement, tiles & adhesive — PO-2026-0017', 9172, '5000'), paid: 0, po: 'PO-2026-0017', grn: 'GRN-2026-0031', match: 'variance', matchNote: 'GLZ-12 price 102.30 vs PO 100.00 (+2.3%, tolerance 2%)' },
  { id: 'b42', number: 'BILL-2026-0042', vendorId: 'v2', supplierRef: 'BD-7781', billDate: '2026-08-31', dueDate: '2026-10-15', lines: exp('Plumbing consumables', 8240, '5000'), paid: 0, po: 'PO-2026-0019', grn: 'GRN-2026-0033', match: 'matched' },
  { id: 'b43', number: 'BILL-2026-0043', vendorId: 'v4', supplierRef: 'NJM-5520', billDate: '2026-10-01', dueDate: '2026-10-16', lines: exp('Microsoft 365 & CAFM licences — Q4', 6400, '5530'), paid: 0, po: null, grn: null, match: 'no_po' },
  { id: 'b44', number: 'BILL-2026-0044', vendorId: 'v5', supplierRef: 'OHS-3391', billDate: '2026-09-18', dueDate: '2026-10-18', lines: exp('Compressor spares — RAK sites', 14250, '5230'), paid: 0, po: 'PO-2026-0021', grn: null, match: 'missing_grn', matchNote: 'Goods receipt not yet recorded' },
  { id: 'b45', number: 'BILL-2026-0045', vendorId: 'v6', supplierRef: 'SFS-10882', billDate: '2026-09-19', dueDate: '2026-10-19', lines: exp('Van fleet servicing — 4 vehicles', 3900, '5230'), paid: 0, po: null, grn: null, match: 'no_po' },
  { id: 'b39', number: 'BILL-2026-0039', vendorId: 'v3', supplierRef: 'EG-22091', billDate: '2026-08-20', dueDate: '2026-09-19', lines: exp('Tempered glass panels', 7240, '5000'), paid: 0, po: 'PO-2026-0014', grn: 'GRN-2026-0027', match: 'matched' },
  { id: 'b46', number: 'BILL-2026-0046', vendorId: 'v7', supplierRef: 'CLC-0447', billDate: '2026-09-30', dueDate: '2026-10-30', lines: exp('Contract review — Desert Mall renewal', 18500, '5500'), paid: 0, po: null, grn: null, match: 'no_po' },
  { id: 'b36', number: 'BILL-2026-0036', vendorId: 'v2', supplierRef: 'BD-7802', billDate: '2026-09-20', dueDate: '2026-11-04', lines: exp('Sanitaryware — Marina Tower', 21060, '5000'), paid: 10000, po: 'PO-2026-0016', grn: 'GRN-2026-0029', match: 'matched' },
];

export const PURCHASE_ORDERS = [
  { number: 'PO-2026-0022', vendorId: 'v1', date: '2026-10-09', net: 12600, grn: 'Not received', billed: 'Not billed' },
  { number: 'PO-2026-0021', vendorId: 'v5', date: '2026-09-10', net: 14250, grn: 'Not received', billed: 'Billed' },
  { number: 'PO-2026-0019', vendorId: 'v2', date: '2026-08-22', net: 8240, grn: 'Received', billed: 'Billed' },
  { number: 'PO-2026-0017', vendorId: 'v1', date: '2026-08-30', net: 9080, grn: 'Received', billed: 'Billed (variance)' },
  { number: 'PO-2026-0016', vendorId: 'v2', date: '2026-09-08', net: 21060, grn: 'Received', billed: 'Billed' },
];

export type BankRule = { id: string; name: string; contains: string; account: string; vatInclusive: boolean };
export const BANK_RULES: BankRule[] = [
  { id: 'r1', name: 'DEWA utilities', contains: 'DEWA', account: '5210', vatInclusive: true },
  { id: 'r2', name: 'WPS payroll run', contains: 'WPS', account: '2440', vatInclusive: false },
  { id: 'r3', name: 'Monthly bank fee', contains: 'ACCT FEE', account: '5700', vatInclusive: false },
  { id: 'r4', name: 'Etisalat business line', contains: 'ETISALAT', account: '5560', vatInclusive: true },
  { id: 'r5', name: 'Salik toll top-up', contains: 'SALIK', account: '5570', vatInclusive: false },
  { id: 'r6', name: 'Card gateway settlement', contains: 'NETWORK INTL', account: '1070', vatInclusive: false },
  { id: 'r7', name: 'Savings profit credit', contains: 'PROFIT CREDIT', account: '4600', vatInclusive: false },
];

export type FeedRow = {
  id: string;
  date: string;
  payee: string;
  description: string;
  amount: number;
  match?: { kind: 'invoice' | 'bill'; id: string };
};

/** Statement lines for 1021 (Operations ••• 4471) not yet in the ledger. */
export const SEED_FEED: FeedRow[] = [
  { id: 'f1', date: '2026-10-01', payee: 'Ajman Warehousing LLC', description: 'IPI TRF INV-2026-0106', amount: 13440, match: { kind: 'invoice', id: 'i106' } },
  { id: 'f2', date: '2026-10-02', payee: 'DEWA', description: 'DEWA DD 2003417781', amount: -4382.5 },
  { id: 'f3', date: '2026-10-03', payee: 'Sharjah Ports Services LLC', description: 'TRF REF INV-2026-0104 PART', amount: 12000, match: { kind: 'invoice', id: 'i104' } },
  { id: 'f4', date: '2026-10-05', payee: 'WPS Payroll', description: 'WPS SIF 0925 SALARY', amount: -67200 },
  { id: 'f5', date: '2026-10-06', payee: 'Emirates NBD', description: 'MONTHLY ACCT FEE', amount: -90 },
  { id: 'f6', date: '2026-10-06', payee: 'Gulf Glass Works LLC', description: 'CHQ DEP 000418', amount: 5000, match: { kind: 'invoice', id: 'i91' } },
  { id: 'f7', date: '2026-10-07', payee: 'Emirates Glass Industries LLC', description: 'OUTWARD TRF EG-22091', amount: -7602, match: { kind: 'bill', id: 'b39' } },
  { id: 'f8', date: '2026-10-08', payee: 'Etisalat', description: 'ETISALAT BUSINESS 04-3349', amount: -1187.55 },
  { id: 'f9', date: '2026-10-08', payee: 'Carrefour MOE', description: 'POS 4471 CARREFOUR MOE', amount: -642.3 },
  { id: 'f10', date: '2026-10-09', payee: 'Network International', description: 'NETWORK INTL SETTLEMENT', amount: 8420 },
  { id: 'f11', date: '2026-10-10', payee: 'Najm IT Solutions FZ-LLC', description: 'SO NAJM IT DOMAINS', amount: -2310 },
  { id: 'f12', date: '2026-10-11', payee: 'Al Noor Trading LLC', description: 'IPI TRF 7781 ALNOOR', amount: 25830, match: { kind: 'invoice', id: 'i94' } },
  { id: 'f13', date: '2026-10-12', payee: 'RTA', description: 'SALIK TOPUP 7781', amount: -500 },
  { id: 'f14', date: '2026-10-12', payee: 'Emirates NBD', description: 'SAVINGS PROFIT CREDIT', amount: 312.4 },
];

/** Ledger balances at LEDGER_CUTOFF, debit-positive. AR/AP/3100 are derived below so the TB always ties. */
const BASE_FIXED: Record<string, number> = {
  '1000': 2000, '1010': 45200, '1021': 1186440, '1022': 74300, '1030': 250000,
  '1110': -14200, '1300': 45000, '1350': 12000, '1400': 18640,
  '1550': 86000, '1640': -28700, '1560': 145000, '1650': -48300,
  '2010': -22400, '2020': -18750, '2200': -41530, '2410': -96500, '3000': -500000,
  '4000': -1684000, '4010': -142000, '4040': -534500, '4050': 18600, '4060': 12400, '4600': -2140,
  '5000': 742800, '5100': 603000, '5110': 151200, '5120': 28900, '5200': 180000, '5210': 41800,
  '5230': 26300, '5400': 38600, '5500': 44500, '5530': 31200, '5540': 14600, '5600': 57000,
  '5640': 8400, '5700': 1240, '5710': 6900,
};

export const invoiceBalance = (i: Invoice) => (i.writtenOff ? 0 : r2(docTotals(i.lines).gross - i.paid));
export const billBalance = (b: Bill) => r2(docTotals(b.lines).gross - b.paid);

export const BASE_BALANCES: Record<string, number> = (() => {
  const b = { ...BASE_FIXED };
  b['1100'] = r2(SEED_INVOICES.filter((i) => i.stage === 'issued').reduce((s, i) => s + invoiceBalance(i), 0));
  b['2000'] = -r2(SEED_BILLS.reduce((s, x) => s + billBalance(x), 0));
  // ponytail: mock-only plug so the seeded TB balances; a real ledger never derives RE.
  b['3100'] = -r2(Object.values(b).reduce((s, v) => s + v, 0));
  return b;
})();

/** Month-end total cash (1000/1010/1021/1022/1030), Apr→Sep 2026. Last point equals BASE cash. */
export const CASH_TREND = [
  { m: 'Apr', v: 1312000 }, { m: 'May', v: 1348500 }, { m: 'Jun', v: 1391200 },
  { m: 'Jul', v: 1402800 }, { m: 'Aug', v: 1455100 }, { m: 'Sep', v: 1557940 },
];
export const CASH_OUTFLOWS = [
  { m: 'Jul', out: 181200 }, { m: 'Aug', out: 170500 }, { m: 'Sep', out: 175600 },
];

/** Prior year Jan–Sep 2025, signed like balances (income negative). */
export const PRIOR_PL: Record<string, number> = {
  '4000': -1512400, '4010': -118000, '4040': -461200, '4050': 14200, '4060': 9800, '4600': -1650,
  '5000': 688300, '5100': 562000, '5110': 140400, '5120': 26100, '5200': 168000, '5210': 39100,
  '5230': 22800, '5400': 31500, '5500': 39800, '5530': 26400, '5540': 13900, '5600': 52000,
  '5640': 5100, '5700': 1180, '5710': 9400,
};

export const EXPENSE_GROUPS = [
  { name: 'Payroll & benefits', codes: ['5100', '5110', '5120'], mom: [86400, 87100, 87900] },
  { name: 'Premises & utilities', codes: ['5200', '5210', '5230'], mom: [31200, 29800, 30650] },
  { name: 'Marketing', codes: ['5400'], mom: [4200, 5600, 3900] },
  { name: 'Professional fees', codes: ['5500'], mom: [3800, 4100, 6900] },
  { name: 'IT & software', codes: ['5530'], mom: [3400, 3400, 3550] },
  { name: 'Insurance', codes: ['5540'], mom: [1620, 1620, 1620] },
  { name: 'Finance costs', codes: ['5700', '5710'], mom: [850, 840, 910] },
];
export const MOM_MONTHS = ['Jul 2026', 'Aug 2026', 'Sep 2026'];

/** YTD ex-VAT sales and credit notes (4050) per customer; totals tie to 4000+4010+4040 and 4050. */
export const SALES_YTD: Record<string, { gross: number; credit: number }> = {
  cu1: { gross: 412300, credit: 4200 }, cu2: { gross: 558900, credit: 6800 },
  cu3: { gross: 401750, credit: 0 }, cu4: { gross: 296400, credit: 3100 },
  cu5: { gross: 214650, credit: 0 }, cu6: { gross: 168200, credit: 2500 },
  cu7: { gross: 96300, credit: 0 }, cu8: { gross: 212000, credit: 2000 },
};

/** Q3 2026 standard-rated supplies by Emirate (Box 1, F-43). `adj` is the VAT adjustment amount. */
export const VAT_BOX1: { emirate: Emirate; amount: number; adj: number }[] = [
  { emirate: 'Abu Dhabi', amount: 120000, adj: 0 },
  { emirate: 'Dubai', amount: 210000, adj: -120 },
  { emirate: 'Sharjah', amount: 80000, adj: 0 },
  { emirate: 'Ajman', amount: 30000, adj: 0 },
  { emirate: 'Umm Al Quwain', amount: 15000, adj: 0 },
  { emirate: 'Ras Al Khaimah', amount: 18000, adj: 0 },
  { emirate: 'Fujairah', amount: 7000, adj: 0 },
];
/** Labels verbatim from schema.sql vat_return_box_definitions. Box 2 label is unseeded (F-42). */
export const VAT_OTHER = {
  box3: { label: 'Supplies subject to reverse charge', amount: 12400 },
  box4: { label: 'Zero-rated supplies', amount: 42000 },
  box5: { label: 'Exempt supplies', amount: 0 },
  box6: { label: 'Goods imported into UAE (FTA auto-fills from customs/TRN)', amount: 0 },
  box7: { label: 'Adjustments to imported goods', amount: 0 },
  box9: { label: 'Standard-rated expenses (recoverable input tax)', amount: 318600, adj: 0 },
  box10: { label: 'Imports subject to reverse charge (input side)', amount: 12400 },
};

/** feature-spec-1_1_G §2.4 / G-4 / G-35. */
export const CT = { zeroBand: 375000, rate: 9, alertPct: 90, sbrRevenueCap: 3000000 };

const sumWhere = (b: Record<string, number>, pred: (code: string) => boolean) =>
  r2(Object.entries(b).filter(([c]) => pred(c)).reduce((s, [, v]) => s + v, 0));
export const cashTotal = (b: Record<string, number>) => sumWhere(b, (c) => CASH_ACCOUNTS.includes(c));

/** P&L from debit-positive balances. Taxable income shown is accounting profit before CT adjustments. */
export function plSummary(b: Record<string, number>) {
  const grossSales = -sumWhere(b, (c) => INCOME_ACCOUNTS.includes(c));
  const revenue = -sumWhere(b, (c) => c[0] === '4' && c !== '4600');
  const otherIncome = -(b['4600'] ?? 0);
  const cogs = sumWhere(b, (c) => c.startsWith('50'));
  const opex = sumWhere(b, (c) => c[0] === '5' && !c.startsWith('50') && c !== '5830');
  const pbt = r2(revenue + otherIncome - cogs - opex);
  const ebitda = r2(pbt - otherIncome + (b['5600'] ?? 0) + (b['5710'] ?? 0));
  const ct = r2((Math.max(0, pbt - CT.zeroBand) * CT.rate) / 100);
  return { grossSales, revenue, otherIncome, cogs, opex, pbt, ebitda, ct, net: r2(pbt - ct) };
}

export const RELATED_PARTIES = [
  { party: 'Horizon Holdings LLC', relationship: 'Parent company', nature: 'Management fee charged', date: '2026-09-30', amount: 120000, account: '2030' },
  { party: 'Horizon Facilities FZE', relationship: 'Sister entity (common control)', nature: 'Sub-contracted FM services', date: '2026-08-31', amount: 46500, account: '1150' },
  { party: 'Khalid Al Mansoori', relationship: 'Director', nature: 'Director remuneration', date: '2026-09-25', amount: 36000, account: '2030' },
];
