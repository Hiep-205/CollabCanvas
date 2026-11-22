import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

const PAGE_SIZE = 20;
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ActivityAction = 'task_created' | 'task_updated' | 'task_status_changed' | 'task_assignees_changed' | 'checklist_changed' | 'task_trashed' | 'task_restored';

export function recordActivity(tx: Prisma.TransactionClient, event: {
  workspaceId: string;
  actorUserId: string;
  taskId: string;
  taskTitle: string;
  action: ActivityAction;
  fromStatus?: string | null;
  toStatus?: string | null;
}) {
  return tx.activity_events.create({ data: {
    workspace_id: event.workspaceId,
    actor_user_id: event.actorUserId,
    task_id: event.taskId,
    task_title: event.taskTitle,
    action: event.action,
    from_status: event.fromStatus ?? null,
    to_status: event.toStatus ?? null,
  } });
}

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, workspaceId: string, pageInput?: string, taskId?: string) {
    const member = await this.prisma.workspace_members.findUnique({ where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } }, select: { role: true } });
    if (!member) throw new NotFoundException('Workspace not found');
    if (pageInput !== undefined && !/^[1-9]\d*$/.test(pageInput)) throw new BadRequestException('Invalid page');
    const page = pageInput === undefined ? 1 : Number(pageInput);
    if (!Number.isSafeInteger(page) || page > 1000) throw new BadRequestException('Page must be 1-1000');
    if (taskId !== undefined && !TASK_ID.test(taskId)) throw new BadRequestException('Invalid taskId');

    const events = await this.prisma.activity_events.findMany({
      where: { workspace_id: workspaceId, ...(taskId ? { task_id: taskId } : {}) },
      include: { users: { select: { display_name: true } } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
    });
    return {
      items: events.slice(0, PAGE_SIZE).map((event) => ({
        id: event.id,
        taskId: event.task_id,
        taskTitle: event.task_title,
        actorUserId: event.actor_user_id,
        actorName: event.users.display_name,
        action: event.action,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        createdAt: event.created_at,
      })),
      nextPage: events.length > PAGE_SIZE ? page + 1 : null,
    };
  }
}
