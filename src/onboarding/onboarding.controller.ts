import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { OnboardWorkspaceDto } from './dto/onboard-workspace.dto';
import { OnboardingService } from './onboarding.service';

/**
 * No company exists yet, so these routes do not take a company id and do not
 * set app.current_company_id. The user id comes from SupabaseAuthGuard.
 */
@Controller()
@UseGuards(ThrottlerGuard, SupabaseAuthGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('me')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.profile(user.id);
  }

  @Post('onboarding/workspace')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: OnboardWorkspaceDto) {
    return this.onboarding.createWorkspace(user.id, dto);
  }
}
