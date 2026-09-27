import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { BillExtractionRepository } from './bill-extraction.repository';
import { emptySnapshot } from './extraction-rules';
import { VeryfiDocumentsClient } from './veryfi-documents.client';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
  'image/heic',
  'image/heif',
  'image/webp',
]);
const ALLOWED_EXT = /\.(jpe?g|png|pdf|heic|heif|webp)$/i;
const MAX_BYTES = 20 * 1024 * 1024;

export interface UploadedDocument {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** [feature-spec-1_1_B.md §1 / §2] Single-document ingest. Does not use BullMQ. */
@Injectable()
export class DocumentIngestionService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly veryfi: VeryfiDocumentsClient,
    private readonly extractions: BillExtractionRepository,
  ) {}

  async ingest(companyId: string, uploadedBy: string, file: UploadedDocument) {
    this.assertFile(file);
    const bucket = process.env.BILL_DOCUMENT_BUCKET ?? 'bill-documents';
    const safeName = file.originalname.replace(/[^\w.\-]+/g, '_');
    const path = `${companyId}/${Date.now()}-${safeName}`;
    const upload = await this.supabase.client.storage.from(bucket).upload(path, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });
    if (upload.error) {
      throw new BadRequestException(`STORAGE_UPLOAD_FAILED:${upload.error.message}`);
    }

    const accepted = await this.veryfi.submitFile({
      bytes: file.buffer,
      fileName: file.originalname,
      mimeType: file.mimetype,
    });

    const snapshot = emptySnapshot();
    snapshot.uploaded_by = uploadedBy;
    return this.extractions.insert({
      companyId,
      fileName: file.originalname,
      fileUrl: path,
      fileSize: file.size,
      mimeType: file.mimetype,
      veryfiDocumentId: accepted.id,
      snapshot,
      fieldOrigin: {},
    });
  }

  private assertFile(file: UploadedDocument | undefined): asserts file is UploadedDocument {
    if (!file?.buffer?.length) throw new BadRequestException('FILE_REQUIRED');
    if (file.size > MAX_BYTES) throw new PayloadTooLargeException('FILE_TOO_LARGE');
    const mime = file.mimetype.toLowerCase();
    if (mime === 'image/tiff' || /\.tiff?$/i.test(file.originalname)) {
      throw new BadRequestException('FILE_TYPE_NOT_ALLOWED');
    }
    if (!ALLOWED_MIME.has(mime) && !(mime === 'application/octet-stream' && ALLOWED_EXT.test(file.originalname))) {
      throw new BadRequestException('FILE_TYPE_NOT_ALLOWED');
    }
  }
}
