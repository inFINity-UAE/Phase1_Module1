export type DocumentPhase = 'queued' | 'submitted' | 'completed' | 'failed';

export interface DocumentSubmitJobData {
  companyId: string;
  batchId: string;
  fileName: string;
  fileUrl: string;
  phase: DocumentPhase;
  veryfiDocumentId?: string;
  error?: string;
}

export interface DocumentBatchRecord {
  companyId: string;
  jobIds: string[];
}

export interface DocumentBatchStatus {
  batch_id: string;
  company_id: string;
  total: number;
  queued: number;
  submitted: number;
  completed: number;
  failed: number;
  documents: Array<{
    job_id: string;
    file_name: string;
    phase: DocumentPhase;
    veryfi_document_id: string | null;
  }>;
}
