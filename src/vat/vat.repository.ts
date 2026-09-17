export const VAT_REPOSITORY = Symbol('VAT_REPOSITORY');

export interface VatRepository {
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
  listReturns(companyId: string): Promise<unknown[]>;
  findReturn(id: string): Promise<Record<string, unknown> | null>;
  listGroupSources(periodId: string, groupKey: string): Promise<unknown[]>;
  listProjects(companyId: string): Promise<unknown[]>;
  findProject(id: string): Promise<Record<string, unknown> | null>;
  insertProject(row: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateProject(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteProject(id: string): Promise<void>;
  listItems(companyId: string): Promise<unknown[]>;
  findItem(id: string): Promise<Record<string, unknown> | null>;
  insertItem(row: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateItem(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteItem(id: string): Promise<void>;
  listClaims(companyId: string): Promise<unknown[]>;
  findClaim(id: string): Promise<Record<string, unknown> | null>;
  listDisclosures(companyId: string): Promise<unknown[]>;
  findDisclosure(id: string): Promise<Record<string, unknown> | null>;
}
