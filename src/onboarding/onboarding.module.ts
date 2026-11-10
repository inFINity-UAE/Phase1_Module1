import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OnboardingController } from './onboarding.controller';
import { SignupController } from './signup.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [AuthModule],
  controllers: [OnboardingController, SignupController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
