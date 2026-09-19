import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { handleDatabaseError } from '../common/errors/database-error.mapper';
import { CompanyRole } from '../common/enums/company-role.enum';
import { CtIncomeAdjustmentType } from '../common/enums/ct-income-adjustment-type.enum';
import { CT_REPOSITORY, CtRepository } from './ct.repository';
import {
  CreateCtIncomeAdjustmentDto,
  CtFiscalYearBodyDto,
  RecordRelatedPartyTransactionDto,
} from './dto/ct.dto';

@Injectable()
export class CtService {
  constructor(@Inject(CT_REPOSITORY) private readonly ctRepository: CtRepository) {}

  async taxableProfit(companyId: string, fiscalYear: number, role?: CompanyRole) {
    this.assertAccountantOrOwner(role, 'read a CT taxable-profit estimate');
    try {
      return await this.ctRepository.rpc('get_ct_taxable_profit_estimate', {
        p_company_id: companyId,
        p_fiscal_year: fiscalYear,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async calculate(dto: CtFiscalYearBodyDto, role?: CompanyRole) {
    this.assertAccountantOrOwner(role, 'calculate a CT provision');
    return this.taxableProfit(dto.company_id, dto.fiscal_year, role);
  }

  async postProvision(dto: CtFiscalYearBodyDto, actorId: string, role?: CompanyRole) {
    // [feature-spec-1_1_G.md G-27] Owner-only, same Nest-layer gate as F-8 file.
    this.assertOwner(role, 'post a CT provision');
    try {
      return await this.ctRepository.rpc('create_ct_provision_entry', {
        p_company_id: dto.company_id,
        p_fiscal_year: dto.fiscal_year,
        p_created_by: actorId, // [feature-spec-1_1_G.md G-33]
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async listProvisions(companyId: string, fiscalYear: number | undefined, role?: CompanyRole) {
    this.assertAccountantOrOwner(role, 'list CT provisions');
    try {
      return await this.ctRepository.listProvisions(companyId, fiscalYear);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async sbrEligibility(companyId: string, fiscalYear: number, role?: CompanyRole) {
    this.assertAccountantOrOwner(role, 'check SBR eligibility');
    try {
      return await this.ctRepository.rpc('check_small_business_relief_eligibility', {
        p_company_id: companyId,
        p_fiscal_year: fiscalYear,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async createIncomeAdjustment(
    dto: CreateCtIncomeAdjustmentDto,
    actorId: string,
    role?: CompanyRole,
  ) {
    this.assertAccountantOrOwner(role, 'record a CT income adjustment');
    if (
      dto.adjustment_type !== CtIncomeAdjustmentType.QualifyingDividend &&
      dto.adjustment_type !== CtIncomeAdjustmentType.IntragroupTransaction
    ) {
      throw new BadRequestException(
        'POST /ct/income-adjustments accepts only qualifying_dividend or intragroup_transaction (G-25)',
      );
    }
    const sources = [dto.invoice_line_id, dto.journal_line_id, dto.journal_entry_id].filter(Boolean);
    if (sources.length !== 1) {
      throw new BadRequestException(
        'Manual CT adjustments require exactly one of invoice_line_id, journal_line_id, journal_entry_id (G-32)',
      );
    }
    try {
      return await this.ctRepository.insertIncomeAdjustment({
        company_id: dto.company_id,
        fiscal_year: dto.fiscal_year,
        adjustment_type: dto.adjustment_type,
        amount: dto.amount,
        invoice_line_id: dto.invoice_line_id ?? null,
        journal_line_id: dto.journal_line_id ?? null,
        journal_entry_id: dto.journal_entry_id ?? null,
        recorded_by: actorId,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async freeZoneSummary(companyId: string, fiscalYear: number, role?: CompanyRole) {
    this.assertAccountantOrOwner(role, 'read a free-zone income summary');
    try {
      return await this.ctRepository.rpc('summarize_free_zone_income', {
        p_company_id: companyId,
        p_fiscal_year: fiscalYear,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async recordRelatedParty(
    dto: RecordRelatedPartyTransactionDto,
    role?: CompanyRole,
  ) {
    this.assertAccountantOrOwner(role, 'record a related-party transaction');
    try {
      return await this.ctRepository.rpc('record_related_party_transaction', {
        p_company_id: dto.company_id,
        p_counterparty_name: dto.counterparty_name,
        p_relationship: dto.relationship,
        p_transaction_type: dto.transaction_type,
        p_amount: dto.amount,
        p_transaction_date: dto.transaction_date,
        p_reference_journal_entry_id: dto.reference_journal_entry_id ?? null,
        p_notes: dto.notes ?? null,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async listRelatedParty(companyId: string, role?: CompanyRole) {
    this.assertAccountantOrOwner(role, 'list related-party transactions');
    try {
      return await this.ctRepository.listRelatedParty(companyId);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async returnSummary(companyId: string, fiscalYear: number, role?: CompanyRole) {
    this.assertAccountantOrOwner(role, 'prepare a CT return summary');
    try {
      return await this.ctRepository.rpc('prepare_ct_return_summary', {
        p_company_id: companyId,
        p_fiscal_year: fiscalYear,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  async registrationStatus(companyId: string, role?: CompanyRole) {
    this.assertAccountantOrOwner(role, 'read CT registration status');
    try {
      const row = await this.ctRepository.getRegistrationStatus(companyId);
      if (!row) {
        throw new NotFoundException('Company not found');
      }
      return { trn: row.trn };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      handleDatabaseError(error);
    }
  }

  async penaltyExposure(companyId: string, fiscalYear: number, role?: CompanyRole) {
    this.assertAccountantOrOwner(role, 'check CT penalty exposure');
    try {
      return await this.ctRepository.rpc('check_ct_penalty_exposure', {
        p_company_id: companyId,
        p_fiscal_year: fiscalYear,
      });
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /** [feature-spec-1_1_F.md F-8 analogue / feature-spec-1_1_G.md G-27] */
  private assertOwner(role: CompanyRole | undefined, action: string): void {
    if (role !== CompanyRole.Owner) {
      throw new ForbiddenException(`Only Owner can ${action}`);
    }
  }

  private assertAccountantOrOwner(role: CompanyRole | undefined, action: string): void {
    if (role !== CompanyRole.Accountant && role !== CompanyRole.Owner) {
      throw new ForbiddenException(`Only Owner or Accountant can ${action}`);
    }
  }
}
