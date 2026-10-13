import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { DOCUMENT_OCR_QUEUE } from './document-ocr.constants';
import {
  DocumentBatchRecord,
  DocumentBatchStatus,
  DocumentPhase,
  DocumentSubmitJobData,
} from './document-submission.types';

function batchKey(batchId: string): string {
  return `ocr:batch:${batchId}`;
}

function veryfiKey(documentId: string): string {
  return `ocr:veryfi:${documentId}`;
}

/**
 * [feature-spec-1_1_B.md §4] Submission queue plus the Redis keys the
 * webhook uses to find the job. Connections open only when REDIS_URL is set.
 * ponytail: one Node process holds the queue; a second worker process is the
 * upgrade if submit volume exceeds this API process.
 */
@Injectable()
export class DocumentSubmissionQueue {
  private queue: Queue<DocumentSubmitJobData> | null = null;
  private redis: Redis | null = null;

  isConfigured(): boolean {
    return Boolean(process.env.REDIS_URL);
  }

  private connection(): Redis {
    const url = process.env.REDIS_URL;
    if (!url) throw new ServiceUnavailableException('REDIS_NOT_CONFIGURED');
    return new Redis(url, { maxRetriesPerRequest: null });
  }

  getQueue(): Queue<DocumentSubmitJobData> {
    if (!this.queue) {
      this.queue = new Queue<DocumentSubmitJobData>(DOCUMENT_OCR_QUEUE, {
        connection: this.connection(),
      });
    }
    return this.queue;
  }

  /** Separate connection — BullMQ workers must not share the queue connection. */
  createWorkerConnection(): Redis | null {
    if (!this.isConfigured() || process.env.JEST_WORKER_ID) return null;
    return this.connection();
  }

  private keys(): Redis {
    if (!this.redis) this.redis = this.connection();
    return this.redis;
  }

  async rememberBatch(batchId: string, record: DocumentBatchRecord): Promise<void> {
    await this.keys().set(batchKey(batchId), JSON.stringify(record));
  }

  async readBatch(batchId: string): Promise<DocumentBatchRecord | null> {
    const raw = await this.keys().get(batchKey(batchId));
    if (!raw) return null;
    return JSON.parse(raw) as DocumentBatchRecord;
  }

  async rememberVeryfiDocument(veryfiDocumentId: string, jobId: string): Promise<void> {
    await this.keys().set(veryfiKey(veryfiDocumentId), jobId);
  }

  async jobIdForVeryfiDocument(veryfiDocumentId: string): Promise<string | null> {
    return this.keys().get(veryfiKey(veryfiDocumentId));
  }

  async addJob(jobId: string, data: DocumentSubmitJobData): Promise<void> {
    await this.getQueue().add('submit', data, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: false,
      removeOnFail: false,
    });
  }

  async loadJob(jobId: string): Promise<Job<DocumentSubmitJobData> | null> {
    const job = await Job.fromId<DocumentSubmitJobData>(this.getQueue(), jobId);
    return job ?? null;
  }

  async setPhase(jobId: string, phase: DocumentPhase, error?: string): Promise<void> {
    const job = await this.loadJob(jobId);
    if (!job) throw new NotFoundException('DOCUMENT_JOB_NOT_FOUND');
    const data: DocumentSubmitJobData = { ...job.data, phase, error };
    await job.updateData(data);
  }

  async statusFor(batchId: string, record: DocumentBatchRecord): Promise<DocumentBatchStatus> {
    const documents = [];
    const counts: Record<DocumentPhase, number> = {
      queued: 0,
      submitted: 0,
      completed: 0,
      failed: 0,
    };
    for (const jobId of record.jobIds) {
      const job = await this.loadJob(jobId);
      const phase: DocumentPhase = job?.data.phase ?? 'queued';
      counts[phase] += 1;
      documents.push({
        job_id: jobId,
        file_name: job?.data.fileName ?? '',
        phase,
        veryfi_document_id: job?.data.veryfiDocumentId ?? null,
      });
    }
    return {
      batch_id: batchId,
      company_id: record.companyId,
      total: record.jobIds.length,
      queued: counts.queued,
      submitted: counts.submitted,
      completed: counts.completed,
      failed: counts.failed,
      documents,
    };
  }

  async close(): Promise<void> {
    await this.queue?.close();
    this.redis?.disconnect();
  }
}
