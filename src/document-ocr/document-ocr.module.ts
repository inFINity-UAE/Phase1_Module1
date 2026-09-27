import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillsModule } from '../bills/bills.module';
import { DatabaseModule } from '../database/database.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { BillExtractionRepository } from './bill-extraction.repository';
import { DocumentBatchesController } from './document-batches.controller';
import { DocumentBatchesService } from './document-batches.service';
import { DocumentExtractionsController } from './document-extractions.controller';
import { DocumentIngestionService } from './document-ingestion.service';
import { DocumentPromotionService } from './document-promotion.service';
import { DocumentSubmissionQueue } from './document-submission.queue';
import { DocumentSubmissionWorker } from './document-submission.worker';
import { VeryfiDocumentsClient } from './veryfi-documents.client';
import { VeryfiWebhookController } from './veryfi-webhook.controller';

@Module({
  imports: [AuthModule, DatabaseModule, BillsModule, SuppliersModule],
  controllers: [DocumentBatchesController, DocumentExtractionsController, VeryfiWebhookController],
  providers: [
    DocumentBatchesService,
    DocumentSubmissionQueue,
    DocumentSubmissionWorker,
    VeryfiDocumentsClient,
    BillExtractionRepository,
    DocumentIngestionService,
    DocumentPromotionService,
  ],
})
export class DocumentOcrModule {}
