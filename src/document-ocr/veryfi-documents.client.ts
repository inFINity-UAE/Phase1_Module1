import { Injectable, ServiceUnavailableException } from '@nestjs/common';

const VERYFI_DOCUMENTS_URL = 'https://api.veryfi.com/api/v8/partner/documents/';
const SUBMIT_TIMESTAMPS: number[] = [];

/** [feature-spec-1_1_B.md §4] Shared cap for the URL path and the file path. */
async function paceVeryfiSubmit(): Promise<void> {
  const now = Date.now();
  while (SUBMIT_TIMESTAMPS.length > 0 && now - SUBMIT_TIMESTAMPS[0] >= 1000) {
    SUBMIT_TIMESTAMPS.shift();
  }
  if (SUBMIT_TIMESTAMPS.length >= 60) {
    const wait = 1000 - (now - SUBMIT_TIMESTAMPS[0]);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  SUBMIT_TIMESTAMPS.push(Date.now());
}

/**
 * [feature-spec-1_1_B.md §4] Submit one document with async:true.
 * The caller returns as soon as Veryfi accepts; it does not wait for OCR.
 */
@Injectable()
export class VeryfiDocumentsClient {
  async submitDocument(input: { fileUrl: string; fileName: string }): Promise<{ id: string }> {
    await paceVeryfiSubmit();
    const response = await this.post(
      JSON.stringify({
        file_url: input.fileUrl,
        file_name: input.fileName,
        async: true,
      }),
      { 'Content-Type': 'application/json' },
    );
    return this.readId(response);
  }

  async submitFile(input: { bytes: Buffer; fileName: string; mimeType: string }): Promise<{ id: string }> {
    await paceVeryfiSubmit();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.fileName);
    form.append('async', 'true');
    const response = await this.post(form, {});
    return this.readId(response);
  }

  private async post(body: BodyInit, extraHeaders: Record<string, string>): Promise<Response> {
    const clientId = process.env.VERYFI_CLIENT_ID;
    const username = process.env.VERYFI_USERNAME;
    const apiKey = process.env.VERYFI_API_KEY;
    if (!clientId || !username || !apiKey) {
      throw new ServiceUnavailableException('VERYFI_NOT_CONFIGURED');
    }
    return fetch(VERYFI_DOCUMENTS_URL, {
      method: 'POST',
      headers: {
        ...extraHeaders,
        'CLIENT-ID': clientId,
        AUTHORIZATION: `apikey ${username}:${apiKey}`,
      },
      body,
    });
  }

  private async readId(response: Response): Promise<{ id: string }> {
    if (!response.ok) throw new Error(`VERYFI_SUBMIT_FAILED:${response.status}`);
    const json = (await response.json()) as { id?: string | number };
    if (json.id === undefined || json.id === null || json.id === '') {
      throw new Error('VERYFI_SUBMIT_NO_ID');
    }
    return { id: String(json.id) };
  }
}
