import { BadRequestException, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { SupabaseService } from '../database/supabase.service';
import { OnboardWorkspaceDto } from './dto/onboard-workspace.dto';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

const USER = '11111111-1111-1111-1111-111111111111';

function validBody(): OnboardWorkspaceDto {
  return {
    legal_name: 'Khan Trading LLC',
    trn: null,
    base_currency: 'AED',
    is_free_zone_entity: false,
    fiscal_year_start_month: 1,
    journal_approval_threshold: null,
    default_period_length: 'monthly',
    allow_period_reopen: true,
    write_off_approval_threshold: 5000,
    weekend_days: [6, 7],
    vat_return_frequency: 'quarterly',
    default_emirate: 'dubai',
    customers: [],
  };
}

describe('OnboardingService', () => {
  const rpc = jest.fn();
  const getUserById = jest.fn();
  const eq = jest.fn();
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));

  const service = new OnboardingService({
    client: { rpc, auth: { admin: { getUserById } }, from },
  } as unknown as SupabaseService);

  beforeEach(() => {
    rpc.mockReset();
    getUserById.mockReset();
    eq.mockReset();
    from.mockClear();
  });

  it('sends the verified user id and not a body user id', async () => {
    rpc.mockResolvedValue({
      data: { company_id: '22222222-2222-2222-2222-222222222222', role: 'owner' },
      error: null,
    });
    const result = await service.createWorkspace(USER, validBody());
    expect(result).toEqual({
      company_id: '22222222-2222-2222-2222-222222222222',
      role: 'owner',
    });
    expect(rpc).toHaveBeenCalledWith('onboard_company', {
      p_user_id: USER,
      p_payload: expect.objectContaining({ legal_name: 'Khan Trading LLC' }),
    });
    const payload = rpc.mock.calls[0][1].p_payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('user_id');
    expect(payload).not.toHaveProperty('password');
    expect(payload).not.toHaveProperty('item_description');
  });

  it('returns a generic error when the database rejects the call', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate trn user@secret.example' } });
    await expect(service.createWorkspace(USER, validBody())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createWorkspace(USER, validBody())).rejects.toThrow(
      'Could not create the workspace. Check the details and try again.',
    );
  });

  it('loads the name and phone from auth metadata and only that user memberships', async () => {
    getUserById.mockResolvedValue({
      data: { user: { id: USER, user_metadata: { full_name: 'Amina Khan', phone: '+971501234567' } } },
      error: null,
    });
    eq.mockResolvedValue({
      data: [{ company_id: '22222222-2222-2222-2222-222222222222', role: 'owner', companies: { legal_name: 'Khan Trading LLC' } }],
      error: null,
    });
    const profile = await service.profile(USER);
    expect(profile.full_name).toBe('Amina Khan');
    expect(profile.phone).toBe('+971501234567');
    expect(profile.memberships).toEqual([
      { company_id: '22222222-2222-2222-2222-222222222222', legal_name: 'Khan Trading LLC', role: 'owner' },
    ]);
    expect(eq).toHaveBeenCalledWith('user_id', USER);
  });
});

describe('POST /onboarding/workspace validation and auth', () => {
  let app: INestApplication;
  const getUser = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }] })],
      controllers: [OnboardingController],
      providers: [
        SupabaseAuthGuard,
        {
          provide: OnboardingService,
          useValue: { createWorkspace: jest.fn().mockResolvedValue({ company_id: 'x', role: 'owner' }), profile: jest.fn() },
        },
        { provide: SupabaseService, useValue: { client: { auth: { getUser } } } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
  });

  function url(path: string) {
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return `http://127.0.0.1:${port}${path}`;
  }

  it('rejects a missing token', async () => {
    const response = await fetch(url('/onboarding/workspace'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    });
    expect(response.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } });
    const response = await fetch(url('/onboarding/workspace'), {
      method: 'POST',
      headers: { Authorization: 'Bearer not-a-jwt', 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    });
    expect(response.status).toBe(401);
  });

  it('rejects a user id, a short TRN, and a catalog field', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
    const response = await fetch(url('/onboarding/workspace'), {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody(), user_id: USER, trn: '123', item_description: 'Consulting' }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    const messages = JSON.stringify(body);
    expect(messages).not.toContain(USER);
    expect(messages.toLowerCase()).not.toContain('password');
  });

  it('rejects GET /me without a token', async () => {
    const response = await fetch(url('/me'));
    expect(response.status).toBe(401);
    await expect(Promise.resolve(new UnauthorizedException())).resolves.toBeInstanceOf(UnauthorizedException);
  });
});
