/** [feature-spec-1_1_B.md §4] Receipts & Invoices documented cap. */
export const VERYFI_SUBMIT_LIMIT = { max: 60, duration: 1000 } as const;

/** [feature-spec-1_1_B.md §4] One batch is at most 50 documents. */
export const DOCUMENT_BATCH_MAX = 50;

export const DOCUMENT_OCR_QUEUE = 'document-ocr-submit';
