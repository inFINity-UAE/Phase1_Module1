export const CT_REPOSITORY = Symbol('CT_REPOSITORY');

export interface CtRepository {
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
  listProvisions(companyId: string, fiscalYear?: number): Promise<unknown[]>;
  listRelatedParty(companyId: string): Promise<unknown[]>;
  insertIncomeAdjustment(row: Record<string, unknown>): Promise<Record<string, unknown>>;
  getRegistrationStatus(companyId: string): Promise<{ trn: string | null } | null>;
}
