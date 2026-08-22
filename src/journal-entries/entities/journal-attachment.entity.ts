/** Row shape of public.journal_attachments — [schema.sql] */
export class JournalAttachment {
  id!: string;
  journal_entry_id!: string;
  file_name!: string;
  file_url!: string;
  file_size_bytes!: number | null;
  uploaded_by!: string;
  uploaded_at!: string;
}
