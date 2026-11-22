import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

export const SESSION_COOKIE = 'cc_session';
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type PublicUser = { id: string; email: string; displayName: string };
type Credentials = { email: string; password: string };

function publicUser(user: { id: string; email: string; display_name: string }): PublicUser {
  return { id: user.id, email: user.email, displayName: user.display_name };
}

function parseCredentials(body: unknown): Credentials {
  if (!body || typeof body !== 'object') throw new BadRequestException('Invalid request body');
  const value = body as Record<string, unknown>;
  if (typeof value.email !== 'string' || typeof value.password !== 'string') {
    throw new BadRequestException('Email and password are required');
  }
  const email = value.email.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('Invalid email');
  }
  if (value.password.length < 12 || value.password.length > 128) {
    throw new BadRequestException('Password must be 12-128 characters');
  }
  return { email, password: value.password };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly dummyHash = argon2.hash(randomBytes(32), {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  constructor(private readonly prisma: PrismaService) {}

  async register(body: unknown): Promise<{ user: PublicUser; token: string }> {
    const { email, password } = parseCredentials(body);
    const value = body as Record<string, unknown>;
    if (typeof value.displayName !== 'string' || !value.displayName.trim() || value.displayName.trim().length > 120) {
      throw new BadRequestException('Display name must be 1-120 characters');
    }
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    try {
      const user = await this.prisma.users.create({
        data: { email, password_hash: passwordHash, display_name: value.displayName.trim() },
      });
      return { user: publicUser(user), token: await this.createSession(user.id) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Account cannot be created');
      }
      throw error;
    }
  }

  async login(body: unknown): Promise<{ user: PublicUser; token: string }> {
    const { email, password } = parseCredentials(body);
    const user = await this.prisma.users.findUnique({ where: { email } });
    const valid = await argon2.verify(user?.password_hash ?? await this.dummyHash, password);
    if (!valid || !user?.is_active) throw new UnauthorizedException('Invalid credentials');
    return { user: publicUser(user), token: await this.createSession(user.id) };
  }

  async me(token?: string): Promise<PublicUser> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException();
    const session = await this.prisma.user_sessions.findUnique({
      where: { refresh_token_hash: tokenHash(token) },
      include: { users: true },
    });
    if (!session || session.revoked_at || session.expires_at <= new Date() || !session.users.is_active) {
      throw new UnauthorizedException();
    }
    await this.prisma.user_sessions.update({ where: { id: session.id }, data: { last_used_at: new Date() } });
    return publicUser(session.users);
  }

  async logout(token?: string): Promise<void> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    await this.prisma.user_sessions.updateMany({
      where: { refresh_token_hash: tokenHash(token), revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  async updateProfile(userId: string, body: unknown): Promise<PublicUser> {
    if (!body || typeof body !== 'object') throw new BadRequestException('Invalid request body');
    const value = body as Record<string, unknown>;
    if (typeof value.displayName !== 'string' || !value.displayName.trim() || value.displayName.trim().length > 120) {
      throw new BadRequestException('Display name must be 1-120 characters');
    }
    const user = await this.prisma.users.update({
      where: { id: userId },
      data: { display_name: value.displayName.trim() },
    });
    return publicUser(user);
  }

  async changePassword(userId: string, body: unknown): Promise<{ success: true }> {
    if (!body || typeof body !== 'object') throw new BadRequestException('Invalid request body');
    const value = body as Record<string, unknown>;
    if (typeof value.currentPassword !== 'string' || typeof value.newPassword !== 'string') {
      throw new BadRequestException('Current and new password are required');
    }
    if (value.newPassword.length < 12 || value.newPassword.length > 128) {
      throw new BadRequestException('New password must be 12-128 characters');
    }
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user || !(await argon2.verify(user.password_hash, value.currentPassword))) {
      throw new BadRequestException('Mật khẩu hiện tại không chính xác');
    }
    const newHash = await argon2.hash(value.newPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    await this.prisma.users.update({
      where: { id: userId },
      data: { password_hash: newHash },
    });
    return { success: true };
  }

  async deleteAccount(userId: string): Promise<{ success: true }> {
    await this.prisma.users.delete({ where: { id: userId } });
    return { success: true };
  }

  private async createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.user_sessions.create({
      data: {
        user_id: userId,
        refresh_token_hash: tokenHash(token),
        expires_at: new Date(Date.now() + SESSION_LIFETIME_MS),
      },
    });
    return token;
  }
}
