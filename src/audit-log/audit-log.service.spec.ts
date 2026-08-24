import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction } from '../common/enums/audit-action.enum';
import { AuditLogService } from './audit-log.service';
import { AUDIT_LOG_REPOSITORY, AuditLogRepository } from './audit-log.repository';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

const COMPANY_ID = '00000000-0000-0000-0000-000000000002';
const RECORD_ID = '66666666-6666-6666-6666-666666666666';
const ACTOR_ID = '33333333-3333-3333-3333-333333333333';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let repository: jest.Mocked<AuditLogRepository>;

  beforeEach(async () => {
    repository = {
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: AUDIT_LOG_REPOSITORY, useValue: repository },
      ],
    }).compile();

    service = module.get(AuditLogService);
  });

  it('returns audit history in chronological order for a journal entry lifecycle', async () => {
    const query: QueryAuditLogDto = {
      company_id: COMPANY_ID,
      record_id: RECORD_ID,
      table_name: 'journal_entries',
    };

    const lifecycle = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        company_id: COMPANY_ID,
        table_name: 'journal_entries',
        record_id: RECORD_ID,
        action: AuditAction.Insert,
        actor_id: ACTOR_ID,
        old_data: null,
        new_data: { status: 'draft' },
        notes: null,
        created_at: '2026-08-22T10:00:00.000Z',
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        company_id: COMPANY_ID,
        table_name: 'journal_entries',
        record_id: RECORD_ID,
        action: AuditAction.Update,
        actor_id: ACTOR_ID,
        old_data: { status: 'draft' },
        new_data: { status: 'posted' },
        notes: null,
        created_at: '2026-08-22T11:00:00.000Z',
      },
      {
        id: '33333333-3333-3333-3333-333333333333',
        company_id: COMPANY_ID,
        table_name: 'journal_entries',
        record_id: RECORD_ID,
        action: AuditAction.Update,
        actor_id: ACTOR_ID,
        old_data: { status: 'posted' },
        new_data: { status: 'reversed', reversed_by_entry_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
        notes: null,
        created_at: '2026-08-22T12:00:00.000Z',
      },
    ];

    repository.find.mockResolvedValue(lifecycle);

    const result = await service.find(query);

    expect(repository.find).toHaveBeenCalledWith(query);
    expect(result).toHaveLength(3);
    expect(result[0].action).toBe(AuditAction.Insert);
    expect(result[1].new_data).toEqual({ status: 'posted' });
    expect(result[2].new_data).toMatchObject({ status: 'reversed' });
    expect(result[0].created_at <= result[1].created_at).toBe(true);
    expect(result[1].created_at <= result[2].created_at).toBe(true);
  });

  it('passes optional actor and date filters through to the repository', async () => {
    const query: QueryAuditLogDto = {
      company_id: COMPANY_ID,
      actor_id: ACTOR_ID,
      from: '2026-08-01',
      to: '2026-08-31',
    };

    repository.find.mockResolvedValue([]);

    await service.find(query);

    expect(repository.find).toHaveBeenCalledWith(query);
  });
});
