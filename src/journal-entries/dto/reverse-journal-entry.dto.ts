import { IsPostgresUuid } from '../../common/validators/is-postgres-uuid';

/** Body for POST /journal-entries/:id/reverse — [feature-spec] one-click reversal. */
export class ReverseJournalEntryDto {
  @IsPostgresUuid()
  created_by!: string;
}
