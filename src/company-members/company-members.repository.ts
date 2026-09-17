import { CompanyRole } from '../common/enums/company-role.enum';

export const COMPANY_MEMBERS_REPOSITORY = Symbol('COMPANY_MEMBERS_REPOSITORY');

export type CompanyResourceKind =
  | 'journal_entry'
  | 'journal_line'
  | 'account'
  | 'accounting_period'
  | 'recurring_template'
  | 'recurring_template_line'
  | 'customer'
  | 'quotation'
  | 'quotation_line'
  | 'invoice'
  | 'invoice_line'
  | 'credit_note'
  | 'credit_note_line'
  | 'payment'
  | 'payment_application'
  | 'public_holiday'
  | 'supplier'
  | 'purchase_order'
  | 'purchase_order_line'
  | 'goods_receipt'
  | 'goods_receipt_line'
  | 'bill'
  | 'bill_line'
  | 'supplier_payment'
  | 'supplier_payment_application'
  | 'supplier_payment_run'
  | 'supplier_statement_line'
  | 'vat_return_period'
  | 'capital_goods_item'
  | 'capital_goods_project'
  | 'vat_bad_debt_relief_claim'
  | 'vat_voluntary_disclosure'
  | 'vat_period_correction';

export interface CompanyMembersRepository {
  findRole(userId: string, companyId: string): Promise<CompanyRole | null>;
  findOwnerUserId(companyId: string): Promise<string | null>;
  findCompanyIdByJournalEntryId(entryId: string): Promise<string | null>;
  findCompanyIdByJournalLineId(lineId: string): Promise<string | null>;
  findCompanyIdByAccountId(accountId: string): Promise<string | null>;
  findCompanyIdByAccountingPeriodId(periodId: string): Promise<string | null>;
  findCompanyIdByRecurringTemplateId(templateId: string): Promise<string | null>;
  findCompanyIdByRecurringTemplateLineId(lineId: string): Promise<string | null>;
  findCompanyIdByCustomerId(customerId: string): Promise<string | null>;
  findCompanyIdByQuotationId(quotationId: string): Promise<string | null>;
  findCompanyIdByQuotationLineId(lineId: string): Promise<string | null>;
  findCompanyIdByInvoiceId(invoiceId: string): Promise<string | null>;
  findCompanyIdByInvoiceLineId(lineId: string): Promise<string | null>;
  findCompanyIdByCreditNoteId(creditNoteId: string): Promise<string | null>;
  findCompanyIdByCreditNoteLineId(lineId: string): Promise<string | null>;
  findCompanyIdByPaymentId(paymentId: string): Promise<string | null>;
  findCompanyIdByPaymentApplicationId(applicationId: string): Promise<string | null>;
  findCompanyIdByPublicHolidayId(holidayId: string): Promise<string | null>;
  findCompanyIdBySupplierId(supplierId: string): Promise<string | null>;
  findCompanyIdByPurchaseOrderId(poId: string): Promise<string | null>;
  findCompanyIdByPurchaseOrderLineId(lineId: string): Promise<string | null>;
  findCompanyIdByGoodsReceiptId(grnId: string): Promise<string | null>;
  findCompanyIdByGoodsReceiptLineId(lineId: string): Promise<string | null>;
  findCompanyIdByBillId(billId: string): Promise<string | null>;
  findCompanyIdByBillLineId(lineId: string): Promise<string | null>;
  findCompanyIdBySupplierPaymentId(paymentId: string): Promise<string | null>;
  findCompanyIdBySupplierPaymentApplicationId(applicationId: string): Promise<string | null>;
  findCompanyIdBySupplierPaymentRunId(runId: string): Promise<string | null>;
  findCompanyIdBySupplierStatementLineId(lineId: string): Promise<string | null>;
  findCompanyIdByVatReturnPeriodId(id: string): Promise<string | null>;
  findCompanyIdByCapitalGoodsItemId(id: string): Promise<string | null>;
  findCompanyIdByCapitalGoodsProjectId(id: string): Promise<string | null>;
  findCompanyIdByVatBadDebtReliefClaimId(id: string): Promise<string | null>;
  findCompanyIdByVatVoluntaryDisclosureId(id: string): Promise<string | null>;
  findCompanyIdByVatPeriodCorrectionId(id: string): Promise<string | null>;
}
