import {
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { ACCOUNTS_REPOSITORY, AccountsRepository } from './accounts.repository';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { Account } from './entities/account.entity';

@Injectable()
export class AccountsService {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY)
    private readonly accountsRepository: AccountsRepository,
  ) {}

  /** [feature-spec] Custom account creation — DB triggers enforce numbering and depth. */
  async create(dto: CreateAccountDto): Promise<Account> {
    try {
      return await this.accountsRepository.insert(dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAll(companyId?: string): Promise<Account[]> {
    try {
      return await this.accountsRepository.findAll(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findOne(id: string): Promise<Account> {
    try {
      const account = await this.accountsRepository.findById(id);
      if (!account) {
        throw new NotFoundException(`Account ${id} not found`);
      }
      return account;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      handleDatabaseError(error);
    }
  }

  update(_id: string, _dto: UpdateAccountDto): Account {
    throw new NotImplementedException('Not implemented.');
  }

  /** [feature-spec] Deactivate — never hard-delete accounts with history. */
  async deactivate(id: string): Promise<Account> {
    await this.findOne(id);
    try {
      return await this.accountsRepository.updateActive(id, false);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /** Hard delete — DB triggers/FKs return clean 400/409, not 500. */
  async remove(id: string): Promise<void> {
    await this.findOne(id);
    try {
      await this.accountsRepository.delete(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }
}
