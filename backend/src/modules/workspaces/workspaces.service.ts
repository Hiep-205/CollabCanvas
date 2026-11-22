import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkspaceGateway } from '../realtime/workspace.gateway';

const PAGE_SIZE = 20;

function parseWorkspace(body: unknown): { name: string; description: string | null } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Invalid request body');
  }
  const value = body as Record<string, unknown>;
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 120) {
    throw new BadRequestException('Name must be 1-120 characters');
  }
  if (value.description !== undefined && value.description !== null && typeof value.description !== 'string') {
    throw new BadRequestException('Invalid description');
  }
  const description = typeof value.description === 'string' ? value.description.trim() : null;
  if (description && description.length > 2000) throw new BadRequestException('Description is too long');
  return { name: value.name.trim(), description: description || null };
}

function workspaceResult(workspace: {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}, role: string) {
  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    role,
    createdAt: workspace.created_at,
    updatedAt: workspace.updated_at,
  };
}

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService, private readonly gateway: WorkspaceGateway) {}

  private async assertOwner(userId: string, workspaceId: string): Promise<void> {
    const membership = await this.prisma.workspace_members.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
      select: { role: true },
    });
    if (membership?.role !== 'owner') throw new ForbiddenException('Only the owner can manage members');
  }

  async changeMemberRole(userId: string, workspaceId: string, memberId: string, body: unknown) {
    await this.assertOwner(userId, workspaceId);
    if (memberId === userId) throw new BadRequestException('Owner cannot change own role');
    const role = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).role : undefined;
    if (role !== 'editor' && role !== 'viewer') throw new BadRequestException('Role must be editor or viewer');
    const updated = await this.prisma.workspace_members.updateMany({
      where: { workspace_id: workspaceId, user_id: memberId, role: { in: ['editor', 'viewer'] } },
      data: { role },
    });
    if (!updated.count) throw new NotFoundException('Member not found');
    await this.gateway.membershipChanged(workspaceId, memberId, role);
    return { id: memberId, role };
  }

  async removeMember(userId: string, workspaceId: string, memberId: string) {
    await this.assertOwner(userId, workspaceId);
    if (memberId === userId) throw new BadRequestException('Owner cannot remove self');
    const removed = await this.prisma.workspace_members.deleteMany({
      where: { workspace_id: workspaceId, user_id: memberId, role: { in: ['editor', 'viewer'] } },
    });
    if (!removed.count) throw new NotFoundException('Member not found');
    await this.gateway.membershipChanged(workspaceId, memberId, null);
    return { success: true };
  }

  async create(userId: string, body: unknown) {
    const data = parseWorkspace(body);
    const workspace = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.workspaces.create({ data });
      await transaction.workspace_members.create({
        data: { workspace_id: created.id, user_id: userId, role: 'owner' },
      });
      return created;
    });
    return workspaceResult(workspace, 'owner');
  }

  async list(userId: string, pageInput?: string) {
    if (pageInput !== undefined && !/^[1-9]\d*$/.test(pageInput)) {
      throw new BadRequestException('Page must be an integer from 1 to 1000');
    }
    const page = pageInput === undefined ? 1 : Number(pageInput);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000) {
      throw new BadRequestException('Page must be an integer from 1 to 1000');
    }
    const memberships = await this.prisma.workspace_members.findMany({
      where: { user_id: userId },
      orderBy: [{ joined_at: 'desc' }, { workspace_id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      select: {
        role: true,
        workspaces: {
          select: { id: true, name: true, description: true, created_at: true, updated_at: true },
        },
      },
    });
    return {
      items: memberships.slice(0, PAGE_SIZE).map((member) => workspaceResult(member.workspaces, member.role)),
      nextPage: memberships.length > PAGE_SIZE ? page + 1 : null,
    };
  }

  async findOne(userId: string, workspaceId: string) {
    const membership = await this.prisma.workspace_members.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
      select: {
        role: true,
        workspaces: {
          select: { id: true, name: true, description: true, created_at: true, updated_at: true },
        },
      },
    });
    if (!membership) throw new NotFoundException('Workspace not found');
    return workspaceResult(membership.workspaces, membership.role);
  }

  async listMembers(userId: string, workspaceId: string, pageInput?: string) {
    await this.findOne(userId, workspaceId);
    if (pageInput !== undefined && !/^[1-9]\d*$/.test(pageInput)) throw new BadRequestException('Invalid page');
    const page = pageInput === undefined ? 1 : Number(pageInput);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new BadRequestException('Invalid page');
    const members = await this.prisma.workspace_members.findMany({
      where: { workspace_id: workspaceId },
      orderBy: [{ joined_at: 'asc' }, { user_id: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      select: { role: true, users: { select: { id: true, display_name: true, email: true } } },
    });
    return { items: members.slice(0, PAGE_SIZE).map((member) => ({ id: member.users.id, displayName: member.users.display_name, email: member.users.email, role: member.role })), nextPage: members.length > PAGE_SIZE ? page + 1 : null };
  }

  async update(userId: string, workspaceId: string, body: unknown) {
    const membership = await this.prisma.workspace_members.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
    });
    if (membership?.role !== 'owner') {
      throw new ForbiddenException('Only the owner can update workspace');
    }
    const data = parseWorkspace(body);
    const updated = await this.prisma.workspaces.update({
      where: { id: workspaceId },
      data: { name: data.name, description: data.description, updated_at: new Date() },
    });
    return workspaceResult(updated, membership.role);
  }

  async remove(userId: string, workspaceId: string) {
    const membership = await this.prisma.workspace_members.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
    });
    if (!membership || membership.role !== 'owner') {
      throw new ForbiddenException('Only the owner can delete the workspace');
    }
    await this.prisma.workspaces.delete({ where: { id: workspaceId } });
    return { success: true };
  }

  async leave(userId: string, workspaceId: string) {
    const membership = await this.prisma.workspace_members.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
    });
    if (!membership) throw new NotFoundException('Not a member of this workspace');
    if (membership.role === 'owner') {
      const ownerCount = await this.prisma.workspace_members.count({
        where: { workspace_id: workspaceId, role: 'owner' },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException('Workspace must have at least one owner. Transfer ownership or delete the workspace.');
      }
    }
    await this.prisma.workspace_members.delete({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
    });
    await this.gateway.membershipChanged(workspaceId, userId, null);
    return { success: true };
  }
}
