import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireCompanyMembership } from '../auth/decorators/require-company-membership.decorator';
import { CompanyMembershipGuard } from '../auth/guards/company-membership.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CreatePaymentApplicationDto } from './dto/create-payment-application.dto';
import { PaymentsService } from './payments.service';

/** [feature-spec-1_1_D.md §3.3 / §4.3] Apply payment credit; advance reclass post. */
@Controller('payment-applications')
@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)
export class PaymentApplicationsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @RequireCompanyMembership({ type: 'body_ref', resource: 'payment', field: 'payment_id' })
  create(
    @Body() dto: CreatePaymentApplicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentsService.createApplication(dto, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCompanyMembership({ type: 'param', resource: 'payment_application' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.deleteApplication(id);
  }

  @Post(':id/post')
  @RequireCompanyMembership({ type: 'param', resource: 'payment_application' })
  post(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.postAdvanceApplication(id, user.id);
  }
}
