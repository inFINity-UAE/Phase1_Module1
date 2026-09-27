import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { DOCUMENT_OCR_QUEUE, VERYFI_SUBMIT_LIMIT } from './document-ocr.constants';
import { DocumentSubmissionQueue } from './document-submission.queue';
import { DocumentSubmitJobData } from './document-submission.types';
import { VeryfiDocumentsClient } from './veryfi-documents.client';

/**
 * [feature-spec-1_1_B.md §4] Submits to Veryfi and returns. The webhook,
 * not this worker, records OCR completion.
 */
@Injectable()
export class DocumentSubmissionWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<DocumentSubmitJobData> | null = null;
  private connection: Redis | null = null;

  constructor(
    private readonly queue: DocumentSubmissionQueue,
    private readonly veryfi: VeryfiDocumentsClient,
  ) {}

  onModuleInit(): void {
    this.connection = this.queue.createWorkerConnection();
    if (!this.connection) return;
    this.worker = new Worker<DocumentSubmitJobData>(
      DOCUMENT_OCR_QUEUE,
      (job) => this.submit(job),
      {
        connection: this.connection,
        concurrency: 10,
        limiter: { max: VERYFI_SUBMIT_LIMIT.max, duration: VERYFI_SUBMIT_LIMIT.duration },
      },
    );
  }

  async submit(job: Job<DocumentSubmitJobData>): Promise<{ veryfiDocumentId: string }> {
    const accepted = await this.veryfi.submitDocument({
      fileUrl: job.data.fileUrl,
      fileName: job.data.fileName,
    });
    await job.updateData({
      ...job.data,
      phase: 'submitted',
      veryfiDocumentId: accepted.id,
    });
    if (job.id) {
      await this.queue.rememberVeryfiDocument(accepted.id, job.id);
    }
    return { veryfiDocumentId: accepted.id };
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.connection?.disconnect();
    await this.queue.close();
  }
}
