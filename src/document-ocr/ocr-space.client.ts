import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';

const OCR_SPACE_URL = 'https://api.ocr.space/parse/image';

/** Free OCR.space plan accepts about 1 MB per file. */
export const OCR_SPACE_MAX_BYTES = 1_048_576;

interface OcrSpaceResult {
  ParsedText?: string;
  FileParseExitCode?: number;
  ErrorMessage?: string;
}

/**
 * Temporary provider while Veryfi credits are unavailable.
 * Synchronous: the parsed text comes back on this call. No webhook.
 */
@Injectable()
export class OcrSpaceClient {
  async parseFile(input: { bytes: Buffer; fileName: string; mimeType: string }): Promise<{ text: string }> {
    const apiKey = process.env.OCR_SPACE_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException('OCR_SPACE_NOT_CONFIGURED');
    if (input.bytes.length > OCR_SPACE_MAX_BYTES) {
      throw new BadRequestException('OCR_SPACE_FILE_TOO_LARGE');
    }

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.fileName);
    form.append('language', 'eng');
    form.append('isOverlayRequired', 'false');

    const response = await fetch(OCR_SPACE_URL, {
      method: 'POST',
      headers: { apikey: apiKey },
      body: form,
    });
    if (!response.ok) {
      throw new BadRequestException(`OCR_SPACE_FAILED:${response.status}`);
    }
    return { text: textFromOcrSpace(await response.json()) };
  }
}

/** Pulls ParsedText. Throws when OCR.space reports a processing error. */
export function textFromOcrSpace(body: unknown): string {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('OCR_SPACE_EMPTY_RESPONSE');
  }
  const record = body as {
    IsErroredOnProcessing?: boolean;
    ErrorMessage?: string | string[] | null;
    ParsedResults?: OcrSpaceResult[];
  };
  if (record.IsErroredOnProcessing) {
    const message = Array.isArray(record.ErrorMessage)
      ? record.ErrorMessage.join(' ')
      : record.ErrorMessage;
    throw new BadRequestException(message || 'OCR_SPACE_PROCESSING_ERROR');
  }
  const parts = (record.ParsedResults ?? [])
    .filter((result) => result.FileParseExitCode === undefined || result.FileParseExitCode === 1)
    .map((result) => result.ParsedText ?? '');
  return parts.join('\n').trim();
}
