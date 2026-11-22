import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

const PAGE_SIZE = 10;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(userId: string, pageInput?: string) {
    const page = pageInput === undefined ? 1 : Number(pageInput);
    if (
      (pageInput !== undefined && !/^[1-9]\d*$/.test(pageInput)) ||
      !Number.isSafeInteger(page) ||
      page > 1000
    ) {
      throw new BadRequestException('Page must be 1-1000');
    }
    const accessible: Prisma.tasksWhereInput = {
      deleted_at: null,
      workspaces: { workspace_members: { some: { user_id: userId } } },
    };
    const assigned: Prisma.tasksWhereInput = {
      ...accessible,
      status: { not: 'done' },
      task_assignees: { some: { user_id: userId } },
    };
    const now = new Date();
    const [workspaceCount, taskCount, completedCount, myOpenCount, myOverdueCount, tasks] =
      await this.prisma.$transaction(
        [
          this.prisma.workspace_members.count({ where: { user_id: userId } }),
          this.prisma.tasks.count({ where: accessible }),
          this.prisma.tasks.count({ where: { ...accessible, status: 'done' } }),
          this.prisma.tasks.count({ where: assigned }),
          this.prisma.tasks.count({ where: { ...assigned, due_at: { lt: now } } }),
          this.prisma.tasks.findMany({
            where: assigned,
            select: {
              id: true,
              title: true,
              workspace_id: true,
              status: true,
              priority: true,
              due_at: true,
              workspaces: { select: { name: true } },
            },
            orderBy: [{ due_at: { sort: 'asc', nulls: 'last' } }, { updated_at: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE + 1,
          }),
        ],
        { isolationLevel: 'RepeatableRead', timeout: 5000 },
      );
    return {
      summary: { workspaceCount, taskCount, completedCount, myOpenCount, myOverdueCount },
      tasks: tasks.slice(0, PAGE_SIZE).map((task) => ({
        id: task.id,
        title: task.title,
        workspaceId: task.workspace_id,
        workspaceName: task.workspaces.name,
        status: task.status,
        priority: task.priority,
        dueAt: task.due_at,
      })),
      page,
      nextPage: tasks.length > PAGE_SIZE ? page + 1 : null,
      asOf: now.toISOString(),
    };
  }
}
