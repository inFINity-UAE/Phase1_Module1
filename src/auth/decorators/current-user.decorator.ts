import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../authenticated-user';

/** [feature-spec decision #10] Session identity — never read actor ids from the body. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user?.id) {
      throw new Error('CurrentUser used without SupabaseAuthGuard');
    }
    return request.user;
  },
);
