import { BillStatus } from './common/enums/bill-status.enum';
import { CreateBillLineDto } from './dto/create-bill-line.dto';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillLineDto } from './dto/update-bill-line.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { BillLine } from './entities/bill-line.entity';
import { BillWithLines } from './entities/bill-with-lines.entity';
import { Bill } from './entities/bill.entity';

export const BILLS_REPOSITORY = Symbol('BILLS_REPOSITORY');

export interface InsertBillParams extends CreateBillDto {
  created_by: string;
}

export interface BillHeaderPatch extends UpdateBillDto {
  status?: BillStatus;
  scheduled_payment_date?: string | null;
  payment_match_override_reason?: string;
  payment_match_overridden_by?: string;
  payment_match_overridden_at?: string;
}

export interface BillsRepository {
  insertHeader(params: InsertBillParams): Promise<Bill>;
  findAll(companyId: string, status?: BillStatus): Promise<Bill[]>;
  findByIdWithLines(id: string): Promise<BillWithLines | null>;
  updateHeader(id: string, patch: BillHeaderPatch): Promise<Bill>;
  deleteHeader(id: string): Promise<void>;
  insertLine(billId: string, dto: CreateBillLineDto): Promise<BillLine>;
  updateLine(id: string, dto: UpdateBillLineDto): Promise<BillLine>;
  deleteLine(id: string): Promise<void>;
  findLineById(lineId: string): Promise<BillLine | null>;
  findSupplierActive(supplierId: string): Promise<boolean | null>;
  findSupplierCompanyId(supplierId: string): Promise<string | null>;
  runThreeWayMatch(billId: string): Promise<void>;
  issueBill(billId: string, createdBy: string, immediatePost: boolean): Promise<Bill>;
  voidBill(
    billId: string,
    voidReason: string,
    createdBy: string,
  ): Promise<{
    bill: Bill;
    ledger_reversal_status: 'reversed' | 'skipped_no_posting';
  }>;
}
