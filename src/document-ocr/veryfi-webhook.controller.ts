import { Body, Controller, Headers, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { DocumentBatchesService, veryfiDocumentIdFromPayload } from './document-batches.service';
import { DocumentPromotionService } from './document-promotion.service';

/**
 * [feature-spec-1_1_B.md §4] Veryfi completion callback.
 * Updates bill_extraction_meta and may promote to a bill via §3.
 * BullMQ job phase is updated only when that queue is configured.
 */
@Controller('webhooks/veryfi')
export class VeryfiWebhookController {
  constructor(
    private readonly batches: DocumentBatchesService,
    private readonly promotion: DocumentPromotionService,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Headers('x-veryfi-webhook-secret') secret: string | undefined,
    @Body() body: unknown,
  ) {
    this.batches.assertWebhookSecret(secret);
    const veryfiId = veryfiDocumentIdFromPayload(body);
    if (!veryfiId) throw new NotFoundException('VERYFI_DOCUMENT_ID_MISSING');

    let extraction: unknown = null;
    try {
      extraction = await this.promotion.ingestWebhook(veryfiId, body);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }

    if (process.env.DOCUMENT_OCR_BATCH_ENABLED === 'true' && process.env.REDIS_URL) {
      try {
        await this.batches.handleVeryfiWebhook(secret, body);
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }

    return { ok: true, extraction };
  }
}
