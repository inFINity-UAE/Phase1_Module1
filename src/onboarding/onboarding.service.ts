import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { OnboardWorkspaceDto } from './dto/onboard-workspace.dto';

export type Membership = {
  company_id: string;
  legal_name: string;
  role: string;
};

export type MeProfile = {
  full_name: string;
  phone: string;
  memberships: Membership[];
};

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * User id is the verified JWT subject. A second call returns the company
   * the user already belongs to.
   */
  async createWorkspace(userId: string, dto: OnboardWorkspaceDto): Promise<{ company_id: string; role: string }> {
    const payload = {
      legal_name: dto.legal_name.trim(),
      trn: dto.trn?.trim() || null,
      base_currency: dto.base_currency,
      is_free_zone_entity: dto.is_free_zone_entity,
      fiscal_year_start_month: dto.fiscal_year_start_month,
      journal_approval_threshold: dto.journal_approval_threshold ?? null,
      default_period_length: dto.default_period_length,
      allow_period_reopen: dto.allow_period_reopen,
      write_off_approval_threshold: dto.write_off_approval_threshold,
      weekend_days: dto.weekend_days,
      vat_return_frequency: dto.vat_return_frequency,
      default_emirate: dto.default_emirate ?? null,
      customers: dto.customers.map((c) => ({
        customer_name: c.customer_name.trim(),
        trn: c.trn?.trim() || null,
        email: c.email?.trim() || null,
        phone: c.phone?.trim() || null,
        billing_address: c.billing_address?.trim() || null,
        credit_limit: c.credit_limit ?? null,
      })),
    };

    const { data, error } = await this.supabase.client.rpc('onboard_company', {
      p_user_id: userId,
      p_payload: payload,
    });

    if (error || !data || typeof data !== 'object') {
      this.logger.error(`onboard_company failed code=${error?.code ?? 'empty'}`);
      throw new BadRequestException('Could not create the workspace. Check the details and try again.');
    }

    const row = data as { company_id?: string; role?: string };
    if (!row.company_id || !row.role) {
      this.logger.error('onboard_company returned an incomplete result');
      throw new BadRequestException('Could not create the workspace. Check the details and try again.');
    }
    return { company_id: row.company_id, role: row.role };
  }

  async profile(userId: string): Promise<MeProfile> {
    const { data: userData, error: userError } = await this.supabase.client.auth.admin.getUserById(userId);
    if (userError || !userData.user) {
      this.logger.error(`profile lookup failed code=${userError?.code ?? 'empty'}`);
      throw new BadRequestException('Could not load your profile.');
    }
    const meta = (userData.user.user_metadata ?? {}) as { full_name?: string; phone?: string };

    const { data, error } = await this.supabase.client
      .from('company_members')
      .select('company_id, role, companies(legal_name)')
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`membership lookup failed code=${error.code}`);
      throw new BadRequestException('Could not load your profile.');
    }

    const memberships: Membership[] = (data ?? []).map((row) => {
      const company = row.companies as { legal_name?: string } | { legal_name?: string }[] | null;
      const legal = Array.isArray(company) ? company[0]?.legal_name : company?.legal_name;
      return {
        company_id: row.company_id as string,
        legal_name: legal ?? '',
        role: row.role as string,
      };
    });

    return {
      full_name: typeof meta.full_name === 'string' ? meta.full_name : '',
      phone: typeof meta.phone === 'string' ? meta.phone : '',
      memberships,
    };
  }
}
