import { CreateAccountDto } from './dto/create-account.dto';
import { Account } from './entities/account.entity';

export const ACCOUNTS_REPOSITORY = Symbol('ACCOUNTS_REPOSITORY');

export interface AccountsRepository {
  insert(dto: CreateAccountDto): Promise<Account>;
  findAll(companyId?: string): Promise<Account[]>;
  findById(id: string): Promise<Account | null>;
  updateActive(id: string, isActive: boolean): Promise<Account>;
  delete(id: string): Promise<void>;
}
