import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CreateAccountDto } from './dto/create-account.dto';
import { OnboardingService } from './onboarding.service';

/** Public. There is no session yet, so this route is not behind SupabaseAuthGuard. */
@Controller()
@UseGuards(ThrottlerGuard)
export class SignupController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('onboarding/account')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  create(@Body() dto: CreateAccountDto) {
    return this.onboarding.createAccount(dto);
  }
}
