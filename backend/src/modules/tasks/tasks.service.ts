import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { recordActivity } from '../activity/activity.service';
import { WorkspaceGateway } from '../realtime/workspace.gateway';

const PAGE_SIZE = 20;
const MAX_BIGINT = 9223372036854775807n;
const STATUSES = ['todo', 'in_progress', 'done'] as const;
const PRIORITIES = ['low', 'normal', 'high'] as const;
const CREATE_FIELDS = ['title', 'description', 'blockedReason', 'status', 'priority', 'dueAt', 'sortOrder'];
const UPDATE_FIELDS = [...CREATE_FIELDS, 'version'];

type TaskStatus = (typeof STATUSES)[number];
type TaskPriority = (typeof PRIORITIES)[number];
type TaskChanges = {
  title?: string;
  description?: string | null;
  blocked_reason?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_at?: Date | null;
  sort_order?: bigint;
};

function taskResult(task: {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  blocked_reason: string | null;
  status: string;
  priority: string;
  due_at: Date | null;
  sort_order: bigint;
  version: bigint;
  created_by_user_id: string;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  task_assignees?: { user_id: string }[];
  task_checklist_items?: { id: string; title: string; is_done: boolean; sort_order: number }[];
}) {
  return {
    id: task.id,
    workspaceId: task.workspace_id,
    title: task.title,
    description: task.description,
    blockedReason: task.blocked_reason,
    status: task.status,
    priority: task.priority,
    dueAt: task.due_at,
    sortOrder: task.sort_order.toString(),
    version: task.version.toString(),
    createdByUserId: task.created_by_user_id,
    updatedByUserId: task.updated_by_user_id,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    assigneeIds: task.task_assignees?.map((item) => item.user_id) ?? [],
    checklist: task.task_checklist_items?.map((item) => ({ id: item.id, title: item.title, isDone: item.is_done, sortOrder: item.sort_order })) ?? [],
  };
}

function parsePositiveBigint(value: unknown, field: string, allowZero: boolean): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new BadRequestException(`${field} must be a decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_BIGINT || (!allowZero && parsed === 0n)) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return parsed;
}

function parseBody(body: unknown, fields: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Invalid request body');
  }
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => !fields.includes(key))) {
    throw new BadRequestException('Unsupported task field');
  }
  return value;
}

function parseChanges(value: Record<string, unknown>): TaskChanges {
  const changes: TaskChanges = {};
  if ('title' in value) {
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 200) {
      throw new BadRequestException('Title must be 1-200 characters');
    }
    changes.title = value.title.trim();
  }
  if ('description' in value) {
    if (value.description !== null && typeof value.description !== 'string') {
      throw new BadRequestException('Invalid description');
    }
    const description = typeof value.description === 'string' ? value.description.trim() : null;
    if (description && description.length > 10_000) throw new BadRequestException('Description is too long');
    changes.description = description || null;
  }
  if ('blockedReason' in value) {
    if (value.blockedReason !== null && typeof value.blockedReason !== 'string') {
      throw new BadRequestException('Invalid blocked reason');
    }
    const reason = typeof value.blockedReason === 'string' ? value.blockedReason.trim() : null;
    if (reason && reason.length > 500) throw new BadRequestException('Blocked reason is too long');
    changes.blocked_reason = reason || null;
  }
  if ('status' in value) {
    if (!STATUSES.includes(value.status as TaskStatus)) throw new BadRequestException('Invalid status');
    changes.status = value.status as TaskStatus;
  }
  if ('priority' in value) {
    if (!PRIORITIES.includes(value.priority as TaskPriority)) throw new BadRequestException('Invalid priority');
    changes.priority = value.priority as TaskPriority;
  }
  if ('dueAt' in value) {
    if (value.dueAt !== null) {
      if (typeof value.dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.dueAt)) {
        throw new BadRequestException('dueAt must be an ISO date-time with timezone');
      }
      const date = new Date(value.dueAt);
      if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid dueAt');
      changes.due_at = date;
    } else {
      changes.due_at = null;
    }
  }
  if ('sortOrder' in value) changes.sort_order = parsePositiveBigint(value.sortOrder, 'sortOrder', true);
  if (changes.status === 'done' && changes.blocked_reason) {
    throw new BadRequestException('Completed task cannot have a blocked reason');
  }
  if (changes.status === 'done') changes.blocked_reason = null;
  return changes;
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
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceGateway: WorkspaceGateway,
  ) {}

  private async membership(userId: string, workspaceId: string, edit: boolean) {
    const member = await this.prisma.workspace_members.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
      select: { role: true },
    });
    if (!member) throw new NotFoundException('Workspace not found');
    if (edit && member.role === 'viewer') throw new ForbiddenException('Workspace is read-only');
  }

  async create(userId: string, workspaceId: string, body: unknown) {
    await this.membership(userId, workspaceId, true);
    const input = parseBody(body, CREATE_FIELDS);
    if (!('title' in input)) throw new BadRequestException('Title is required');
    const changes = parseChanges(input);
    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tasks.create({ data: {
        workspace_id: workspaceId, title: changes.title!, description: changes.description ?? null,
        blocked_reason: changes.blocked_reason ?? null, status: changes.status ?? 'todo',
        priority: changes.priority ?? 'normal', due_at: changes.due_at ?? null,
        sort_order: changes.sort_order ?? 0n, created_by_user_id: userId,
      } });
      await recordActivity(tx, { workspaceId, actorUserId: userId, taskId: created.id, taskTitle: created.title, action: 'task_created', toStatus: created.status });
      return created;
    });
    const result = taskResult(task);
    this.workspaceGateway.broadcastTaskMutated(workspaceId, result.id, 'created', userId);
    return result;
  }

  async list(userId: string, workspaceId: string, statusInput?: string, pageInput?: string, queryInput?: string, priorityInput?: string, dueInput?: string, assigneeInput?: string) {
    await this.membership(userId, workspaceId, false);
    if (statusInput !== undefined && !STATUSES.includes(statusInput as TaskStatus)) throw new BadRequestException('Invalid status');
    if (priorityInput !== undefined && !PRIORITIES.includes(priorityInput as TaskPriority)) throw new BadRequestException('Invalid priority');
    if (queryInput !== undefined && (typeof queryInput !== 'string' || queryInput.trim().length > 100)) throw new BadRequestException('Invalid query');
    if (dueInput !== undefined && !['overdue', 'today', 'upcoming', 'none'].includes(dueInput)) throw new BadRequestException('Invalid due filter');
    if (assigneeInput !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assigneeInput)) throw new BadRequestException('Invalid assignee');
    const page = parsePage(pageInput);
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const dueWhere = dueInput === 'overdue' ? { lt: now } : dueInput === 'today' ? { gte: todayStart, lt: tomorrowStart } : dueInput === 'upcoming' ? { gte: tomorrowStart } : undefined;
    const tasks = await this.prisma.tasks.findMany({
      where: {
        workspace_id: workspaceId,
        deleted_at: null,
        status: statusInput,
        priority: priorityInput,
        ...(assigneeInput ? { task_assignees: { some: { user_id: assigneeInput } } } : {}),
        ...(queryInput?.trim() ? { OR: [{ title: { contains: queryInput.trim(), mode: 'insensitive' as const } }, { description: { contains: queryInput.trim(), mode: 'insensitive' as const } }] } : {}),
        ...(dueInput === 'none' ? { due_at: null } : dueWhere ? { due_at: dueWhere } : {}),
      },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      include: { task_assignees: { select: { user_id: true } }, task_checklist_items: { select: { id: true, title: true, is_done: true, sort_order: true }, orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }] } },
    });
    return {
      items: tasks.slice(0, PAGE_SIZE).map(taskResult),
      nextPage: tasks.length > PAGE_SIZE ? page + 1 : null,
    };
  }

  async findOne(userId: string, workspaceId: string, taskId: string) {
    await this.membership(userId, workspaceId, false);
    const task = await this.prisma.tasks.findFirst({ where: { id: taskId, workspace_id: workspaceId, deleted_at: null }, include: { task_assignees: { select: { user_id: true } }, task_checklist_items: { select: { id: true, title: true, is_done: true, sort_order: true }, orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }] } } });
    if (!task) throw new NotFoundException('Task not found');
    return taskResult(task);
  }

  async update(userId: string, workspaceId: string, taskId: string, body: unknown) {
    await this.membership(userId, workspaceId, true);
    const input = parseBody(body, UPDATE_FIELDS);
    if (!('version' in input)) throw new BadRequestException('Version is required');
    const version = parsePositiveBigint(input.version, 'version', false);
    const changes = parseChanges(input);
    if (Object.keys(changes).length === 0) throw new BadRequestException('At least one change is required');
    if (changes.blocked_reason && changes.status !== 'done') {
      const task = await this.prisma.tasks.findFirst({ where: { id: taskId, workspace_id: workspaceId, deleted_at: null }, select: { status: true } });
      if (!task) throw new NotFoundException('Task not found');
      if (task.status === 'done' && changes.status === undefined) throw new BadRequestException('Completed task cannot have a blocked reason');
    }

    let statusChanged = false;
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.tasks.findFirst({ where: { id: taskId, workspace_id: workspaceId, deleted_at: null }, select: { title: true, status: true } });
      if (!before) throw new NotFoundException('Task not found');
      const updated = await tx.tasks.updateMany({
        where: { id: taskId, workspace_id: workspaceId, deleted_at: null, version },
        data: { ...changes, version: { increment: 1 }, updated_at: new Date(), updated_by_user_id: userId },
      });
      if (!updated.count) throw new ConflictException('Task has changed; reload before saving');
      statusChanged = changes.status !== undefined && changes.status !== before.status;
      await recordActivity(tx, { workspaceId, actorUserId: userId, taskId, taskTitle: changes.title ?? before.title,
        action: statusChanged ? 'task_status_changed' : 'task_updated',
        ...(statusChanged ? { fromStatus: before.status, toStatus: changes.status } : {}) });
    });
    this.workspaceGateway.broadcastTaskMutated(
      workspaceId,
      taskId,
      statusChanged ? 'status_changed' : 'updated',
      userId,
    );
    return this.findOne(userId, workspaceId, taskId);
  }

  async replaceAssignees(userId: string, workspaceId: string, taskId: string, body: unknown) {
    await this.membership(userId, workspaceId, true);
    const input = parseBody(body, ['version', 'userIds']);
    const version = parsePositiveBigint(input.version, 'version', false);
    const userIds = input.userIds;
    if (!Array.isArray(userIds) || userIds.length > 20 || userIds.some((id) => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) || new Set(userIds).size !== userIds.length) {
      throw new BadRequestException('Invalid assignees');
    }
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.tasks.findFirst({ where: { id: taskId, workspace_id: workspaceId, deleted_at: null }, select: { title: true } });
      if (!task) throw new NotFoundException('Task not found');
      const members = await tx.workspace_members.findMany({ where: { workspace_id: workspaceId, user_id: { in: userIds }, role: { in: ['owner', 'editor'] } }, select: { user_id: true } });
      if (members.length !== userIds.length) throw new BadRequestException('Assignees must be editable workspace members');
      const updated = await tx.tasks.updateMany({ where: { id: taskId, workspace_id: workspaceId, deleted_at: null, version }, data: { version: { increment: 1 }, updated_at: new Date(), updated_by_user_id: userId } });
      if (updated.count === 0) {
        const exists = await tx.tasks.findFirst({ where: { id: taskId, workspace_id: workspaceId, deleted_at: null }, select: { id: true } });
        if (!exists) throw new NotFoundException('Task not found');
        throw new ConflictException('Task has changed; reload before saving');
      }
      await tx.task_assignees.deleteMany({ where: { workspace_id: workspaceId, task_id: taskId } });
      if (userIds.length) await tx.task_assignees.createMany({ data: userIds.map((assignedId) => ({ workspace_id: workspaceId, task_id: taskId, user_id: assignedId, assigned_by_user_id: userId })) });
      await recordActivity(tx, { workspaceId, actorUserId: userId, taskId, taskTitle: task.title, action: 'task_assignees_changed' });
    });
    this.workspaceGateway.broadcastTaskMutated(workspaceId, taskId, 'updated', userId);
    return this.findOne(userId, workspaceId, taskId);
  }

  private async claimChecklistVersion(tx: Prisma.TransactionClient, userId: string, workspaceId: string, taskId: string, version: bigint) {
    const updated = await tx.tasks.updateMany({ where: { id: taskId, workspace_id: workspaceId, deleted_at: null, version }, data: { version: { increment: 1 }, updated_at: new Date(), updated_by_user_id: userId } });
    if (updated.count) {
      const task = await tx.tasks.findFirst({ where: { id: taskId, workspace_id: workspaceId }, select: { title: true } });
      return task!.title;
    }
    const exists = await tx.tasks.findFirst({ where: { id: taskId, workspace_id: workspaceId, deleted_at: null }, select: { id: true } });
    if (!exists) throw new NotFoundException('Task not found');
    throw new ConflictException('Task has changed; reload before saving');
  }

  async addChecklistItem(userId: string, workspaceId: string, taskId: string, body: unknown) {
    await this.membership(userId, workspaceId, true);
    const input = parseBody(body, ['version', 'title']);
    const version = parsePositiveBigint(input.version, 'version', false);
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200) throw new BadRequestException('Checklist title must be 1-200 characters');
    await this.prisma.$transaction(async (tx) => {
      const count = await tx.task_checklist_items.count({ where: { workspace_id: workspaceId, task_id: taskId } });
      if (count >= 30) throw new BadRequestException('Checklist is limited to 30 items');
      const taskTitle = await this.claimChecklistVersion(tx, userId, workspaceId, taskId, version);
      await tx.task_checklist_items.create({ data: { workspace_id: workspaceId, task_id: taskId, title: (input.title as string).trim(), sort_order: count } });
      await recordActivity(tx, { workspaceId, actorUserId: userId, taskId, taskTitle, action: 'checklist_changed' });
    });
    this.workspaceGateway.broadcastTaskMutated(workspaceId, taskId, 'updated', userId);
    return this.findOne(userId, workspaceId, taskId);
  }

  async updateChecklistItem(userId: string, workspaceId: string, taskId: string, itemId: string, body: unknown) {
    await this.membership(userId, workspaceId, true);
    const input = parseBody(body, ['version', 'title', 'isDone']);
    const version = parsePositiveBigint(input.version, 'version', false);
    if (!('title' in input) && !('isDone' in input)) throw new BadRequestException('At least one change is required');
    if ('title' in input && (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200)) throw new BadRequestException('Checklist title must be 1-200 characters');
    if ('isDone' in input && typeof input.isDone !== 'boolean') throw new BadRequestException('Invalid checklist state');
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.task_checklist_items.findFirst({ where: { id: itemId, workspace_id: workspaceId, task_id: taskId }, select: { id: true } });
      if (!item) throw new NotFoundException('Checklist item not found');
      const taskTitle = await this.claimChecklistVersion(tx, userId, workspaceId, taskId, version);
      await tx.task_checklist_items.update({ where: { id: itemId }, data: { ...('title' in input ? { title: (input.title as string).trim() } : {}), ...('isDone' in input ? { is_done: input.isDone as boolean } : {}), updated_at: new Date() } });
      await recordActivity(tx, { workspaceId, actorUserId: userId, taskId, taskTitle, action: 'checklist_changed' });
    });
    this.workspaceGateway.broadcastTaskMutated(workspaceId, taskId, 'updated', userId);
    return this.findOne(userId, workspaceId, taskId);
  }

  async removeChecklistItem(userId: string, workspaceId: string, taskId: string, itemId: string, body: unknown) {
    await this.membership(userId, workspaceId, true);
    const input = parseBody(body, ['version']);
    const version = parsePositiveBigint(input.version, 'version', false);
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.task_checklist_items.findFirst({ where: { id: itemId, workspace_id: workspaceId, task_id: taskId }, select: { id: true } });
      if (!item) throw new NotFoundException('Checklist item not found');
      const taskTitle = await this.claimChecklistVersion(tx, userId, workspaceId, taskId, version);
      await tx.task_checklist_items.delete({ where: { id: itemId } });
      await recordActivity(tx, { workspaceId, actorUserId: userId, taskId, taskTitle, action: 'checklist_changed' });
    });
    this.workspaceGateway.broadcastTaskMutated(workspaceId, taskId, 'updated', userId);
    return this.findOne(userId, workspaceId, taskId);
  }
}
