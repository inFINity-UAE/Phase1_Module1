import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { AccountsModule } from './accounts/accounts.module';
import { AccountingPeriodsModule } from './accounting-periods/accounting-periods.module';
import { CustomersModule } from './customers/customers.module';
import { QuotationsModule } from './quotations/quotations.module';
import { InvoicesModule } from './invoices/invoices.module';
import { CreditNotesModule } from './credit-notes/credit-notes.module';
import { PaymentsModule } from './payments/payments.module';
import { PublicHolidaysModule } from './public-holidays/public-holidays.module';
import { JournalEntriesModule } from './journal-entries/journal-entries.module';
import { RecurringJournalTemplatesModule } from './recurring-journal-templates/recurring-journal-templates.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { ReportsModule } from './reports/reports.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { GoodsReceiptsModule } from './goods-receipts/goods-receipts.module';
import { BillsModule } from './bills/bills.module';
import { SupplierPaymentsModule } from './supplier-payments/supplier-payments.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    AccountsModule,
    AccountingPeriodsModule,
    CustomersModule,
    QuotationsModule,
    InvoicesModule,
    CreditNotesModule,
    PaymentsModule,
    PublicHolidaysModule,
    JournalEntriesModule,
    RecurringJournalTemplatesModule,
    AuditLogModule,
    ReportsModule,
    SuppliersModule,
    PurchaseOrdersModule,
    GoodsReceiptsModule,
    BillsModule,
    SupplierPaymentsModule,
  ],
})
export class AppModule {}
