import { Injectable, NotImplementedException } from '@nestjs/common';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { Account } from './entities/account.entity';

@Injectable()
export class AccountsService {
  create(_dto: CreateAccountDto): Account {
    throw new NotImplementedException('Not implemented.');
  }

  findAll(): Account[] {
    throw new NotImplementedException('Not implemented.');
  }

  findOne(_id: string): Account {
    throw new NotImplementedException('Not implemented.');
  }

  update(_id: string, _dto: UpdateAccountDto): Account {
    throw new NotImplementedException('Not implemented.');
  }
}
