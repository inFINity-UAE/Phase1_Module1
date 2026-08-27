import { CreateAccountDto } from './dto/create-account.dto';
import { Account } from './entities/account.entity';

export const ACCOUNTS_REPOSITORY = Symbol('ACCOUNTS_REPOSITORY');

/** Writable columns for PATCH /accounts/:id — [feature-spec.md decision #36]. */
export interface UpdateAccountRecord {
  account_name?: string;
  sub_category?: string | null;
  description?: string | null;
}

export interface AccountsRepository {
  insert(dto: CreateAccountDto): Promise<Account>;
  findAll(companyId?: string): Promise<Account[]>;
  findById(id: string): Promise<Account | null>;
  update(id: string, patch: UpdateAccountRecord): Promise<Account>;
  updateActive(id: string, isActive: boolean): Promise<Account>;
  delete(id: string): Promise<void>;
}
