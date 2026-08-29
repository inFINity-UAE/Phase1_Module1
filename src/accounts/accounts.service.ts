import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { ACCOUNTS_REPOSITORY, AccountsRepository } from './accounts.repository';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { Account } from './entities/account.entity';
import { AccountTrialBalance } from '../journal-entries/entities/account-trial-balance.entity';
import {
  JOURNAL_ENTRIES_REPOSITORY,
  JournalEntriesRepository,
} from '../journal-entries/journal-entries.repository';

@Injectable()
export class AccountsService {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY)
    private readonly accountsRepository: AccountsRepository,
    @Inject(JOURNAL_ENTRIES_REPOSITORY)
    private readonly journalEntriesRepository: JournalEntriesRepository,
  ) {}

  /** [feature-spec] Custom account creation — DB triggers enforce numbering and depth. */
  async create(dto: CreateAccountDto): Promise<Account> {
    try {
      return await this.accountsRepository.insert(dto);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAll(companyId: string): Promise<Account[]> {
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

  /**
   * [feature-spec.md decision #36/#58] Metadata-only update. Structural columns
   * (account_number, category, normal_balance, hierarchy) are rejected by
   * UpdateAccountDto + forbidNonWhitelisted. System accounts
   * (is_system_account = true, e.g. 3100 Retained Earnings #16) are blocked
   * here for all PATCH fields; schema.sql trg_prevent_system_account_mutation
   * (#58) is the DB backstop for structural/identity columns (service_role).
   */
  async update(id: string, dto: UpdateAccountDto): Promise<Account> {
    const account = await this.findOne(id);

    if (account.is_system_account) {
      throw new BadRequestException(
        `Account ${id} is a system account and cannot be updated`,
      );
    }

    const hasPatch =
      dto.account_name !== undefined ||
      dto.sub_category !== undefined ||
      dto.description !== undefined;
    if (!hasPatch) {
      throw new BadRequestException('No updatable fields provided');
    }

    try {
      return await this.accountsRepository.update(id, {
        ...(dto.account_name !== undefined ? { account_name: dto.account_name } : {}),
        ...(dto.sub_category !== undefined ? { sub_category: dto.sub_category } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /** [feature-spec] Deactivate — never hard-delete accounts with history. */
  async deactivate(id: string): Promise<Account> {
    const account = await this.findOne(id);

    // [feature-spec.md decision #36 / §7.30] System accounts (e.g. 3100) cannot be deactivated.
    if (account.is_system_account) {
      throw new BadRequestException(
        `Account ${id} is a system account and cannot be deactivated`,
      );
    }

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

  /**
   * [feature-spec.md decision #47] Single-account row from v_trial_balance.
   * company_id comes from the account row (guard already verified membership).
   */
  async getTrialBalance(accountId: string): Promise<AccountTrialBalance> {
    const account = await this.findOne(accountId);
    try {
      const row = await this.journalEntriesRepository.getAccountTrialBalance(
        account.company_id,
        accountId,
      );
      if (!row) {
        throw new NotFoundException(
          `Trial balance for account ${accountId} not found`,
        );
      }
      return row;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      handleDatabaseError(error);
    }
  }
}
