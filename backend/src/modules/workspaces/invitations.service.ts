import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

const PAGE_SIZE = 20;
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function parseInvitation(body: unknown): { email: string; role: 'editor' | 'viewer' } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Invalid request body');
  }
  const value = body as Record<string, unknown>;
  if (typeof value.email !== 'string') throw new BadRequestException('Invalid email');
  const email = value.email.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('Invalid email');
  }
  if (value.role !== 'editor' && value.role !== 'viewer') {
    throw new BadRequestException('Role must be editor or viewer');
  }
  return { email, role: value.role };
}

function parsePage(pageInput?: string): number {
  if (pageInput !== undefined && !/^[1-9]\d*$/.test(pageInput)) {
    throw new BadRequestException('Page must be an integer from 1 to 1000');
  }
  const page = pageInput === undefined ? 1 : Number(pageInput);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000) {
    throw new BadRequestException('Page must be an integer from 1 to 1000');
  }
  return page;
}

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(inviterId: string, workspaceId: string, body: unknown) {
    const { email, role } = parseInvitation(body);
    const member = await this.prisma.workspace_members.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: inviterId } },
      select: { role: true },
    });
    if (!member) throw new NotFoundException('Workspace not found');
    if (member.role !== 'owner') throw new ForbiddenException('Only the owner can invite members');

    const invitee = await this.prisma.users.findUnique({
      where: { email },
      select: { id: true, is_active: true },
    });
    const processed = { status: 'processed' };
    if (!invitee?.is_active) return processed;

    const now = new Date();
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existingMember = await transaction.workspace_members.findUnique({
          where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: invitee.id } },
          select: { user_id: true },
        });
        if (existingMember) return processed;

        await transaction.workspace_invitations.updateMany({
          where: {
            workspace_id: workspaceId,
            invitee_user_id: invitee.id,
            status: 'pending',
            expires_at: { lte: now },
          },
          data: { status: 'expired', responded_at: now },
        });
        await transaction.workspace_invitations.create({
          data: {
            workspace_id: workspaceId,
            invitee_user_id: invitee.id,
            inviter_user_id: inviterId,
            role,
            expires_at: new Date(now.getTime() + INVITATION_LIFETIME_MS),
          },
        });
        return processed;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return processed;
      }
      throw error;
    }
  }

  async inbox(inviteeId: string, pageInput?: string) {
    const page = parsePage(pageInput);
    const invitations = await this.prisma.workspace_invitations.findMany({
      where: { invitee_user_id: inviteeId, status: 'pending', expires_at: { gt: new Date() } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      select: {
        id: true,
        role: true,
        created_at: true,
        expires_at: true,
        workspaces: { select: { id: true, name: true } },
        users_workspace_invitations_inviter_user_idTousers: { select: { display_name: true } },
      },
    });
    return {
      items: invitations.slice(0, PAGE_SIZE).map((invitation) => ({
        id: invitation.id,
        workspace: { id: invitation.workspaces.id, name: invitation.workspaces.name },
        inviterName: invitation.users_workspace_invitations_inviter_user_idTousers.display_name,
        role: invitation.role,
        createdAt: invitation.created_at,
        expiresAt: invitation.expires_at,
      })),
      nextPage: invitations.length > PAGE_SIZE ? page + 1 : null,
    };
  }

  async respond(inviteeId: string, invitationId: string, accept: boolean) {
    const now = new Date();
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const invitation = await transaction.workspace_invitations.findFirst({
          where: { id: invitationId, invitee_user_id: inviteeId },
          select: { workspace_id: true, role: true },
        });
        if (!invitation) throw new NotFoundException('Invitation not found');

        const status = accept ? 'accepted' : 'declined';
        const updated = await transaction.workspace_invitations.updateMany({
          where: {
            id: invitationId,
            invitee_user_id: inviteeId,
            status: 'pending',
            expires_at: { gt: now },
          },
          data: { status, responded_at: now },
        });
        if (updated.count !== 1) throw new ConflictException('Invitation is no longer pending');

        if (accept) {
          await transaction.workspace_members.create({
            data: { workspace_id: invitation.workspace_id, user_id: inviteeId, role: invitation.role },
          });
        }
        return { id: invitationId, workspaceId: invitation.workspace_id, status };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Invitation is no longer pending');
      }
      throw error;
    }
  }
}
