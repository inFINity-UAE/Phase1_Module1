import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { CompanyRole } from '../common/enums/company-role.enum';
import { VAT_REPOSITORY, VatRepository } from './vat.repository';
import {
  AdjustCapitalGoodsItemDto,
  CalculateVatReturnDto,
  CreateBadDebtReliefClaimDto,
  CreateCapitalGoodsItemDto,
  CreateCapitalGoodsProjectDto,
  CreateVatCorrectionDto,
  RecordVatPaymentDto,
} from './dto/vat.dto';

@Injectable()
export class VatService {
  constructor(@Inject(VAT_REPOSITORY) private readonly vatRepository: VatRepository) {}

  async calculate(dto: CalculateVatReturnDto, actorId: string) {
    try {
      return await this.vatRepository.rpc('calculate_vat_return', {
        p_company_id: dto.company_id,
        p_period_start: dto.period_start,
        p_actor_id: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findAll(companyId: string) {
    try {
      return await this.vatRepository.listReturns(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findOne(id: string) {
    try {
      const period = await this.vatRepository.findReturn(id);
      if (!period) {
        throw new NotFoundException(`VAT return ${id} not found`);
      }
      const warning = await this.vatRepository.rpc('vat_return_penalty_warning', {
        p_period_id: id,
      });
      return { ...period, penalty_warning: warning };
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async groupTransactions(id: string, groupKey: string) {
    try {
      return await this.vatRepository.listGroupSources(id, groupKey);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async submitForReview(id: string, actorId: string, role?: CompanyRole) {
    // [feature-spec-1_1_F.md F-8]
    if (role !== CompanyRole.Accountant && role !== CompanyRole.Owner) {
      throw new ForbiddenException('Only Accountant or Owner can submit a VAT return for review');
    }
    try {
      return await this.vatRepository.rpc('submit_vat_return_for_review', {
        p_period_id: id,
        p_actor_id: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async approve(id: string, actorId: string, role?: CompanyRole) {
    this.assertOwner(role, 'approve a VAT return');
    try {
      return await this.vatRepository.rpc('approve_vat_return', {
        p_period_id: id,
        p_actor_id: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async file(id: string, actorId: string, role?: CompanyRole) {
    this.assertOwner(role, 'file a VAT return');
    try {
      return await this.vatRepository.rpc('file_vat_return', {
        p_period_id: id,
        p_actor_id: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async export(id: string) {
    try {
      return await this.vatRepository.rpc('export_vat_return', { p_period_id: id });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async reconcile(id: string) {
    try {
      return await this.vatRepository.rpc('reconcile_vat_return', { p_period_id: id });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async claimRefund(id: string, actorId: string, role?: CompanyRole) {
    this.assertOwner(role, 'claim a VAT refund');
    try {
      return await this.vatRepository.rpc('claim_vat_refund', {
        p_period_id: id,
        p_actor_id: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async recordPayment(id: string, dto: RecordVatPaymentDto, actorId: string) {
    try {
      return await this.vatRepository.rpc('record_vat_payment', {
        p_period_id: id,
        p_amount: dto.amount,
        p_payment_date: dto.payment_date,
        p_method: dto.method,
        p_actor_id: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async accruePenalty(id: string, amount: number, actorId: string, role?: CompanyRole) {
    this.assertOwner(role, 'accrue a VAT penalty');
    try {
      return await this.vatRepository.rpc('accrue_vat_penalty', {
        p_period_id: id,
        p_amount: amount,
        p_actor_id: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async calculateApportionment(vatReturnId: string, actorId: string) {
    try {
      return await this.vatRepository.rpc('calculate_partial_exemption', {
        p_period_id: vatReturnId,
        p_actor_id: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createCorrection(id: string, dto: CreateVatCorrectionDto, actorId: string) {
    try {
      return await this.vatRepository.rpc('create_vat_period_correction', {
        p_original_period_id: id,
        p_delta_net_vat: dto.delta_net_vat,
        p_emirate_mismatch: dto.emirate_mismatch ?? false,
        p_discovered_at: dto.discovered_at,
        p_error_description: dto.error_description ?? null,
        p_corrected_figures: dto.corrected_figures ?? {},
        p_actor_id: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async listProjects(companyId: string) {
    try {
      return await this.vatRepository.listProjects(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createProject(dto: CreateCapitalGoodsProjectDto, actorId: string) {
    try {
      return await this.vatRepository.insertProject({
        company_id: dto.company_id,
        description: dto.description,
        asset_category: dto.asset_category,
        created_by: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findProject(id: string) {
    const row = await this.vatRepository.findProject(id);
    if (!row) throw new NotFoundException(`Capital goods project ${id} not found`);
    return row;
  }

  async updateProject(id: string, patch: Record<string, unknown>) {
    try {
      return await this.vatRepository.updateProject(id, patch);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async deleteProject(id: string) {
    try {
      await this.vatRepository.deleteProject(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async listItems(companyId: string) {
    try {
      return await this.vatRepository.listItems(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createItem(dto: CreateCapitalGoodsItemDto, actorId: string) {
    try {
      await this.vatRepository.rpc('assert_cas_threshold', {
        p_company_id: dto.company_id,
        p_project_id: dto.project_id ?? null,
        p_line_net: dto.capital_value,
        p_on_date: dto.acquisition_date,
      });
      const project = dto.project_id ? await this.vatRepository.findProject(dto.project_id) : null;
      const defaultYears = project?.asset_category === 'building_real_estate' ? 10 : 5;
      if (
        dto.adjustment_period_years != null &&
        dto.adjustment_period_years !== defaultYears &&
        !dto.period_override_reason
      ) {
        throw new ForbiddenException('period_override_reason required to override CAS years');
      }
      return await this.vatRepository.insertItem({
        company_id: dto.company_id,
        project_id: dto.project_id ?? null,
        description: dto.description,
        acquisition_date: dto.acquisition_date,
        capital_value: dto.capital_value,
        initial_vat: dto.initial_vat,
        initial_recovery_pct: dto.initial_recovery_pct,
        adjustment_period_years: dto.adjustment_period_years ?? defaultYears,
        period_override_reason: dto.period_override_reason ?? null,
        bill_line_id: dto.bill_line_id ?? null,
        created_by: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findItem(id: string) {
    const row = await this.vatRepository.findItem(id);
    if (!row) throw new NotFoundException(`Capital goods item ${id} not found`);
    return row;
  }

  async updateItem(id: string, patch: Record<string, unknown>) {
    try {
      return await this.vatRepository.updateItem(id, patch);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async deleteItem(id: string) {
    try {
      await this.vatRepository.deleteItem(id);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async adjustItem(id: string, dto: AdjustCapitalGoodsItemDto, actorId: string) {
    try {
      return await this.vatRepository.rpc('run_capital_goods_adjustment', {
        p_item_id: id,
        p_fiscal_year: dto.fiscal_year,
        p_actual_use_pct: dto.actual_use_pct,
        p_actor_id: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createClaim(dto: CreateBadDebtReliefClaimDto, _actorId: string) {
    try {
      return await this.vatRepository.rpc('insert_bad_debt_relief_claim', {
        p_write_off_id: dto.write_off_id,
        p_actor_id: _actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async listClaims(companyId: string) {
    try {
      return await this.vatRepository.listClaims(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async claimRelief(id: string, actorId: string, role?: CompanyRole) {
    this.assertOwner(role, 'claim VAT bad-debt relief');
    try {
      return await this.vatRepository.rpc('claim_bad_debt_relief', {
        p_claim_id: id,
        p_actor_id: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async listDisclosures(companyId: string) {
    try {
      return await this.vatRepository.listDisclosures(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async findDisclosure(id: string) {
    const row = await this.vatRepository.findDisclosure(id);
    if (!row) throw new NotFoundException(`VAT voluntary disclosure ${id} not found`);
    return row;
  }

  async approveDisclosure(id: string, actorId: string, role?: CompanyRole) {
    this.assertOwner(role, 'approve a voluntary disclosure');
    try {
      return await this.vatRepository.rpc('approve_vat_voluntary_disclosure', {
        p_disclosure_id: id,
        p_actor_id: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  private assertOwner(role: CompanyRole | undefined, action: string): void {
    if (role !== CompanyRole.Owner) {
      throw new ForbiddenException(`Only Owner can ${action}`);
    }
  }
}
