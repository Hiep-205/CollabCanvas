import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, PublicUser, SESSION_COOKIE } from './auth.service';

export type AuthenticatedRequest = Request & { currentUser: PublicUser };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.currentUser = await this.auth.me(request.cookies?.[SESSION_COOKIE]);
    return true;
  }
}
