import { Matches } from 'class-validator';

/** Postgres `uuid` accepts any 8-4-4-4-12 hex form (including the seed demo company id). */
export const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function IsPostgresUuid() {
  return Matches(UUID_PATTERN, { message: 'must be a UUID' });
}
