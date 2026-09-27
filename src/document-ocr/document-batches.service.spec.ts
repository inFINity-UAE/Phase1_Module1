import { NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Job } from 'bullmq';
import { VERYFI_SUBMIT_LIMIT } from './document-ocr.constants';
import { DocumentBatchesService, veryfiDocumentIdFromPayload, veryfiPhaseFromPayload } from './document-batches.service';
import { DocumentSubmissionQueue } from './document-submission.queue';
import { DocumentSubmitJobData } from './document-submission.types';
import { DocumentSubmissionWorker } from './document-submission.worker';
import { VeryfiDocumentsClient } from './veryfi-documents.client';

describe('document OCR batch queue (feature-spec-1_1_B.md §4)', () => {
  const companyId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  it('caps Veryfi submits at 60 per second', () => {
    expect(VERYFI_SUBMIT_LIMIT).toEqual({ max: 60, duration: 1000 });
  });

  it('reads a Veryfi id from id, document_id, or data.id', () => {
    expect(veryfiDocumentIdFromPayload({ id: 42 })).toBe('42');
    expect(veryfiDocumentIdFromPayload({ document_id: 'abc' })).toBe('abc');
    expect(veryfiDocumentIdFromPayload({ data: { id: 'nested' } })).toBe('nested');
    expect(veryfiDocumentIdFromPayload({})).toBeNull();
  });

  it('treats a fail event as failed and anything else as completed', () => {
    expect(veryfiPhaseFromPayload({ event: 'document.failed' })).toBe('failed');
    expect(veryfiPhaseFromPayload({ status: 'processed' })).toBe('completed');
  });

  it('submits with async semantics and does not wait past the accept call', async () => {
    const veryfi = {
      submitDocument: jest.fn().mockResolvedValue({ id: 'vf-1' }),
    } as unknown as VeryfiDocumentsClient;
    const queue = {
      rememberVeryfiDocument: jest.fn().mockResolvedValue(undefined),
    } as unknown as DocumentSubmissionQueue;
    const worker = new DocumentSubmissionWorker(queue, veryfi);
    const data: DocumentSubmitJobData = {
      companyId,
      batchId: 'batch-1',
      fileName: 'a.pdf',
      fileUrl: 'https://files.example/a.pdf',
      phase: 'queued',
    };
    const job = {
      id: 'batch-1:0',
      data,
      updateData: jest.fn().mockImplementation(async (next: DocumentSubmitJobData) => {
        job.data = next;
      }),
    } as unknown as Job<DocumentSubmitJobData>;

    const result = await worker.submit(job);

    expect(result).toEqual({ veryfiDocumentId: 'vf-1' });
    expect(veryfi.submitDocument).toHaveBeenCalledWith({
      fileUrl: 'https://files.example/a.pdf',
      fileName: 'a.pdf',
    });
    expect(job.data.phase).toBe('submitted');
    expect(queue.rememberVeryfiDocument).toHaveBeenCalledWith('vf-1', 'batch-1:0');
  });

  describe('DocumentBatchesService', () => {
    const previousSecret = process.env.VERYFI_WEBHOOK_SECRET;

    afterEach(() => {
      process.env.VERYFI_WEBHOOK_SECRET = previousSecret;
    });

    function service(overrides: Partial<DocumentSubmissionQueue> = {}) {
      const queue = {
        isConfigured: () => true,
        addJob: jest.fn().mockResolvedValue(undefined),
        rememberBatch: jest.fn().mockResolvedValue(undefined),
        readBatch: jest.fn(),
        jobIdForVeryfiDocument: jest.fn(),
        setPhase: jest.fn().mockResolvedValue(undefined),
        statusFor: jest.fn().mockImplementation(async (batchId: string, record: { companyId: string; jobIds: string[] }) => ({
          batch_id: batchId,
          company_id: record.companyId,
          total: record.jobIds.length,
          queued: record.jobIds.length,
          submitted: 0,
          completed: 0,
          failed: 0,
          documents: record.jobIds.map((jobId) => ({
            job_id: jobId,
            file_name: 'a.pdf',
            phase: 'queued' as const,
            veryfi_document_id: null,
          })),
        })),
        ...overrides,
      };
      return {
        queue,
        batches: new DocumentBatchesService(queue as unknown as DocumentSubmissionQueue),
      };
    }

    it('returns 503 when Redis is not configured', async () => {
      const { batches } = service({ isConfigured: () => false });
      await expect(
        batches.create({
          company_id: companyId,
          documents: [{ file_name: 'a.pdf', file_url: 'https://files.example/a.pdf' }],
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('enqueues one job per document when batch upload is enabled', async () => {
      const previous = process.env.DOCUMENT_OCR_BATCH_ENABLED;
      process.env.DOCUMENT_OCR_BATCH_ENABLED = 'true';
      try {
        const { batches, queue } = service();
        const status = await batches.create({
          company_id: companyId,
          documents: [
            { file_name: 'a.pdf', file_url: 'https://files.example/a.pdf' },
            { file_name: 'b.pdf', file_url: 'https://files.example/b.pdf' },
          ],
        });
        expect(queue.addJob).toHaveBeenCalledTimes(2);
        expect(status.total).toBe(2);
        expect(status.queued).toBe(2);
        expect(status.company_id).toBe(companyId);
      } finally {
        process.env.DOCUMENT_OCR_BATCH_ENABLED = previous;
      }
    });

    it('hides a batch that belongs to another company', async () => {
      const { batches } = service({
        readBatch: jest.fn().mockResolvedValue({ companyId: 'other', jobIds: ['j1'] }),
      });
      await expect(batches.status('30303030-3030-3030-3030-303030303030', companyId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a webhook with the wrong secret', async () => {
      process.env.VERYFI_WEBHOOK_SECRET = 'expected-secret';
      const { batches } = service();
      await expect(batches.handleVeryfiWebhook('nope', { id: 'vf-1' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('marks the tracked job completed when Veryfi calls back', async () => {
      process.env.VERYFI_WEBHOOK_SECRET = 'expected-secret';
      const { batches, queue } = service({
        jobIdForVeryfiDocument: jest.fn().mockResolvedValue('batch-1:0'),
      });
      await expect(batches.handleVeryfiWebhook('expected-secret', { data: { id: 'vf-1' } })).resolves.toEqual({
        ok: true,
      });
      expect(queue.setPhase).toHaveBeenCalledWith('batch-1:0', 'completed', undefined);
    });

    it('returns 404 when the webhook arrives before the submit mapping exists', async () => {
      process.env.VERYFI_WEBHOOK_SECRET = 'expected-secret';
      const { batches } = service({
        jobIdForVeryfiDocument: jest.fn().mockResolvedValue(null),
      });
      await expect(batches.handleVeryfiWebhook('expected-secret', { id: 'vf-1' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
