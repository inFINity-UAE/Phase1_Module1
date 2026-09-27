import { randomUUID, timingSafeEqual } from 'crypto';
import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateDocumentBatchDto } from './dto/create-document-batch.dto';
import { DocumentSubmissionQueue } from './document-submission.queue';
import { DocumentBatchStatus, DocumentPhase } from './document-submission.types';

function secretsMatch(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Assumption: Veryfi's webhook envelope is not fixed in feature-spec-1_1_B.md.
 * Accept id or data.id. Treat event/status containing "fail" as failed; anything
 * else with an id is completion. Veryfi retries on non-2xx, so a missing job
 * mapping returns 404.
 */
export function veryfiDocumentIdFromPayload(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const nested = record.data;
  const candidates = [record.id, record.document_id];
  if (nested && typeof nested === 'object') {
    candidates.push((nested as Record<string, unknown>).id);
  }
  for (const value of candidates) {
    if (typeof value === 'string' && value !== '') return value;
    if (typeof value === 'number') return String(value);
  }
  return null;
}

export function veryfiPhaseFromPayload(body: unknown): Exclude<DocumentPhase, 'queued' | 'submitted'> {
  if (!body || typeof body !== 'object') return 'completed';
  const record = body as Record<string, unknown>;
  const event = typeof record.event === 'string' ? record.event : '';
  const status = typeof record.status === 'string' ? record.status : '';
  if (/fail/i.test(event) || /fail/i.test(status)) return 'failed';
  return 'completed';
}

/** [feature-spec-1_1_B.md §4] Enqueue, progress, and webhook completion. */
@Injectable()
export class DocumentBatchesService {
  constructor(private readonly queue: DocumentSubmissionQueue) {}

  async create(dto: CreateDocumentBatchDto): Promise<DocumentBatchStatus> {
    if (process.env.DOCUMENT_OCR_BATCH_ENABLED !== 'true') {
      throw new ServiceUnavailableException('DOCUMENT_BATCH_NOT_ENABLED');
    }
    this.requireRedis();
    const batchId = randomUUID();
    const jobIds: string[] = [];
    for (let index = 0; index < dto.documents.length; index += 1) {
      const document = dto.documents[index];
      const jobId = `${batchId}:${index}`;
      jobIds.push(jobId);
      await this.queue.addJob(jobId, {
        companyId: dto.company_id,
        batchId,
        fileName: document.file_name,
        fileUrl: document.file_url,
        phase: 'queued',
      });
    }
    const record = { companyId: dto.company_id, jobIds };
    await this.queue.rememberBatch(batchId, record);
    return this.queue.statusFor(batchId, record);
  }

  async status(batchId: string, companyId: string): Promise<DocumentBatchStatus> {
    this.requireRedis();
    const record = await this.queue.readBatch(batchId);
    if (!record || record.companyId !== companyId) {
      throw new NotFoundException('DOCUMENT_BATCH_NOT_FOUND');
    }
    return this.queue.statusFor(batchId, record);
  }

  assertWebhookSecret(secret: string | undefined): void {
    if (!secretsMatch(secret, process.env.VERYFI_WEBHOOK_SECRET)) {
      throw new UnauthorizedException('VERYFI_WEBHOOK_UNAUTHORIZED');
    }
  }

  async handleVeryfiWebhook(secret: string | undefined, body: unknown): Promise<{ ok: true }> {
    this.assertWebhookSecret(secret);
    const veryfiId = veryfiDocumentIdFromPayload(body);
    if (!veryfiId) {
      throw new NotFoundException('VERYFI_DOCUMENT_ID_MISSING');
    }
    const jobId = await this.queue.jobIdForVeryfiDocument(veryfiId);
    if (!jobId) {
      throw new NotFoundException('VERYFI_DOCUMENT_NOT_TRACKED');
    }
    const phase = veryfiPhaseFromPayload(body);
    await this.queue.setPhase(jobId, phase, phase === 'failed' ? 'veryfi_failed' : undefined);
    return { ok: true };
  }

  private requireRedis(): void {
    if (!this.queue.isConfigured()) {
      throw new ServiceUnavailableException('REDIS_NOT_CONFIGURED');
    }
  }
}
