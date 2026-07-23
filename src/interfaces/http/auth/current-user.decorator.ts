import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '../../../domain/iam/user.entity';
import type { AuthenticatedRequest } from './authenticated-request';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
