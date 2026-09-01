import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CreditNoteLinesController } from './credit-note-lines.controller';
import { CREDIT_NOTES_REPOSITORY } from './credit-notes.repository';
import { SupabaseCreditNotesRepository } from './credit-notes.repository.supabase';
import { CreditNotesController } from './credit-notes.controller';
import { CreditNotesService } from './credit-notes.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [CreditNotesController, CreditNoteLinesController],
  providers: [
    CreditNotesService,
    { provide: CREDIT_NOTES_REPOSITORY, useClass: SupabaseCreditNotesRepository },
  ],
  exports: [CreditNotesService, CREDIT_NOTES_REPOSITORY],
})
export class CreditNotesModule {}
