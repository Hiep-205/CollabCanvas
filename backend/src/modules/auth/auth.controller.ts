import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, SESSION_COOKIE, SESSION_LIFETIME_MS } from './auth.service';
import { AuthenticatedRequest, SessionGuard } from './session.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.register(body);
    this.setCookie(response, result.token);
    return result.user;
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(body);
    this.setCookie(response, result.token);
    return result.user;
  }

  @Get('me')
  me(@Req() request: Request) {
    return this.auth.me(request.cookies?.[SESSION_COOKIE]);
  }

  @Patch('profile')
  @UseGuards(SessionGuard)
  updateProfile(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.auth.updateProfile(request.currentUser.id, body);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  changePassword(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.auth.changePassword(request.currentUser.id, body);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.[SESSION_COOKIE]);
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    response.clearCookie(SESSION_COOKIE, { path: '/api' });
  }

  @Delete('account')
  @UseGuards(SessionGuard)
  async deleteAccount(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.deleteAccount(request.currentUser.id);
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    response.clearCookie(SESSION_COOKIE, { path: '/api' });
    return { success: true };
  }

  private setCookie(response: Response, token: string) {
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_LIFETIME_MS,
    });
  }
}
