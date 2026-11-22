import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { recordActivity } from '../activity/activity.service';
import { WorkspaceGateway } from '../realtime/workspace.gateway';

const PAGE_SIZE = 20;
const MAX_VERSION = 9223372036854775807n;

function parseVersion(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > MAX_VERSION) {
    throw new BadRequestException('Invalid version');
  }
  return BigInt(value);
}

function parseChange(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid request body');
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['version', 'deleted'].includes(key)) || typeof value.deleted !== 'boolean') {
    throw new BadRequestException('Invalid trash change');
  }
  return { version: parseVersion(value.version), deleted: value.deleted };
}

@Injectable()
export class TrashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceGateway: WorkspaceGateway,
  ) {}

  private async membership(userId: string, workspaceId: string, edit: boolean) {
    const member = await this.prisma.workspace_members.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } }, select: { role: true },
    });
    if (!member) throw new NotFoundException('Workspace not found');
    if (edit && member.role === 'viewer') throw new ForbiddenException('Workspace is read-only');
  }

  async list(userId: string, workspaceId: string, type: string, pageInput?: string) {
    await this.membership(userId, workspaceId, false);
    if (type !== 'tasks' && type !== 'notes') throw new BadRequestException('Invalid trash type');
    if (pageInput !== undefined && !/^[1-9]\d*$/.test(pageInput)) throw new BadRequestException('Invalid page');
    const page = pageInput === undefined ? 1 : Number(pageInput);
    if (!Number.isSafeInteger(page) || page > 1000) throw new BadRequestException('Invalid page');
    const workspace = await this.prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { canvas_version: true } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (type === 'tasks') {
      const rows = await this.prisma.tasks.findMany({
        where: { workspace_id: workspaceId, deleted_at: { not: null } },
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1,
        select: { id: true, title: true, deleted_at: true, version: true },
      });
      return { items: rows.slice(0, PAGE_SIZE).map((item) => ({ type: 'task', id: item.id, title: item.title,
        deletedAt: item.deleted_at, version: item.version.toString() })), nextPage: rows.length > PAGE_SIZE ? page + 1 : null,
        canvasVersion: workspace.canvas_version.toString() };
    }
    const rows = await this.prisma.canvas_nodes.findMany({
      where: { workspace_id: workspaceId, node_type: 'note', deleted_at: { not: null } },
      orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1,
      select: { id: true, note_text: true, deleted_at: true, tasks: { select: { deleted_at: true } } },
    });
    return { items: rows.slice(0, PAGE_SIZE).map((item) => ({ type: 'note', id: item.id, text: item.note_text,
      deletedAt: item.deleted_at, parentTaskDeleted: !!item.tasks?.deleted_at })), nextPage: rows.length > PAGE_SIZE ? page + 1 : null,
      canvasVersion: workspace.canvas_version.toString() };
  }

  async changeTask(userId: string, workspaceId: string, taskId: string, body: unknown) {
    await this.membership(userId, workspaceId, true);
    const { version, deleted } = parseChange(body);
    const result = await this.prisma.$transaction(async (tx) => {
      const task = await tx.tasks.findFirst({ where: { id: taskId, workspace_id: workspaceId }, select: { title: true } });
      if (!task) throw new NotFoundException('Task not found');
      const workspace = await tx.workspaces.update({ where: { id: workspaceId }, data: { canvas_version: { increment: 1 } }, select: { canvas_version: true } });
      const updated = await tx.tasks.updateMany({
        where: { id: taskId, workspace_id: workspaceId, version, deleted_at: deleted ? null : { not: null } },
        data: { deleted_at: deleted ? new Date() : null, version: { increment: 1 }, updated_at: new Date(), updated_by_user_id: userId },
      });
      if (!updated.count) {
        throw new ConflictException('Task has changed; reload before changing trash state');
      }
      await recordActivity(tx, { workspaceId, actorUserId: userId, taskId, taskTitle: task.title, action: deleted ? 'task_trashed' : 'task_restored' });
      return { id: taskId, deleted, version: (version + 1n).toString(), canvasVersion: workspace.canvas_version.toString() };
    });
    this.workspaceGateway.broadcastTaskMutated(workspaceId, taskId, result.deleted ? 'trashed' : 'restored', userId);
    this.workspaceGateway.broadcastCanvasBumped(workspaceId, result.canvasVersion, userId);
    return result;
  }

  async changeNote(userId: string, workspaceId: string, noteId: string, body: unknown) {
    await this.membership(userId, workspaceId, true);
    const { version, deleted } = parseChange(body);
    const result = await this.prisma.$transaction(async (tx) => {
      const bumped = await tx.workspaces.updateMany({ where: { id: workspaceId, canvas_version: version }, data: { canvas_version: { increment: 1 } } });
      if (!bumped.count) throw new ConflictException('Canvas has changed; reload before changing trash state');
      const note = await tx.canvas_nodes.findFirst({ where: { id: noteId, workspace_id: workspaceId, node_type: 'note' },
        select: { id: true, tasks: { select: { deleted_at: true } } } });
      if (!note) throw new NotFoundException('Note not found');
      if (!deleted && note.tasks?.deleted_at) throw new ConflictException('Restore the parent task first');
      const updated = await tx.canvas_nodes.updateMany({
        where: { id: noteId, workspace_id: workspaceId, node_type: 'note', deleted_at: deleted ? null : { not: null } },
        data: { deleted_at: deleted ? new Date() : null, version: { increment: 1 }, updated_at: new Date(), updated_by_user_id: userId },
      });
      if (!updated.count) throw new ConflictException('Note trash state has changed');
      return { id: noteId, deleted, canvasVersion: (version + 1n).toString() };
    });
    this.workspaceGateway.broadcastCanvasBumped(workspaceId, result.canvasVersion, userId);
    return result;
  }
}
