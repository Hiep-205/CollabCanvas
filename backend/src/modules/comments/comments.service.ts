import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkspaceGateway } from '../realtime/workspace.gateway';

const MAX_CONTENT_LENGTH = 5000;
const PAGE_SIZE = 20;

export interface CommentAuthor {
  id: string;
  displayName: string;
}

export interface CommentItem {
  id: string;
  taskId: string;
  author: CommentAuthor;
  content: string;
  parentCommentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  isDeleted: boolean;
  mentionedUserIds: string[];
  replies?: CommentItem[];
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
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceGateway: WorkspaceGateway,
  ) {}

  private async assertMembership(userId: string, workspaceId: string, needEdit: boolean) {
    const member = await this.prisma.workspace_members.findUnique({
      where: {
        workspace_id_user_id: {
          workspace_id: workspaceId,
          user_id: userId,
        },
      },
      select: { role: true },
    });

    if (!member) {
      throw new NotFoundException('Workspace not found');
    }

    if (needEdit && member.role === 'viewer') {
      throw new ForbiddenException('Workspace is read-only');
    }

    return member;
  }

  async list(userId: string, workspaceId: string, taskId: string) {
    await this.assertMembership(userId, workspaceId, false);

    const task = await this.prisma.tasks.findFirst({
      where: {
        id: taskId,
        workspace_id: workspaceId,
        deleted_at: null,
      },
      select: { id: true },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const allComments = await this.prisma.task_comments.findMany({
      where: {
        workspace_id: workspaceId,
        task_id: taskId,
      },
      include: {
        users: { select: { id: true, display_name: true } },
        comment_mentions: { select: { mentioned_user_id: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    const rootComments: CommentItem[] = [];
    const repliesByParentId = new Map<string, CommentItem[]>();

    for (const comment of allComments) {
      const isDeleted = Boolean(comment.deleted_at);
      const item: CommentItem = {
        id: comment.id,
        taskId: comment.task_id,
        author: {
          id: comment.users.id,
          displayName: comment.users.display_name,
        },
        content: isDeleted ? '[Bình luận đã bị xóa]' : comment.content,
        parentCommentId: comment.parent_comment_id,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        isDeleted,
        mentionedUserIds: comment.comment_mentions.map((m) => m.mentioned_user_id),
        replies: [],
      };

      if (!comment.parent_comment_id) {
        rootComments.push(item);
      } else {
        const list = repliesByParentId.get(comment.parent_comment_id) ?? [];
        list.push(item);
        repliesByParentId.set(comment.parent_comment_id, list);
      }
    }

    const items: CommentItem[] = [];
    let totalCount = 0;

    for (const root of rootComments) {
      const allReplies = repliesByParentId.get(root.id) ?? [];
      const activeReplies = allReplies.filter((r) => !r.isDeleted);
      root.replies = activeReplies;

      if (root.isDeleted) {
        if (activeReplies.length > 0) {
          items.push(root);
          totalCount += activeReplies.length;
        }
      } else {
        items.push(root);
        totalCount += 1 + activeReplies.length;
      }
    }

    return {
      items,
      totalCount,
    };
  }

  async create(userId: string, workspaceId: string, taskId: string, body: unknown) {
    await this.assertMembership(userId, workspaceId, true);

    const task = await this.prisma.tasks.findFirst({
      where: {
        id: taskId,
        workspace_id: workspaceId,
        deleted_at: null,
      },
      select: { id: true, title: true },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid request body');
    }

    const data = body as Record<string, unknown>;

    if (typeof data.content !== 'string' || !data.content.trim()) {
      throw new BadRequestException('Content is required');
    }

    const content = data.content.trim();
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new BadRequestException(`Content must not exceed ${MAX_CONTENT_LENGTH} characters`);
    }

    let parentCommentId: string | null = null;
    if (data.parentCommentId !== undefined && data.parentCommentId !== null) {
      if (
        typeof data.parentCommentId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          data.parentCommentId,
        )
      ) {
        throw new BadRequestException('Invalid parentCommentId');
      }

      const parentComment = await this.prisma.task_comments.findFirst({
        where: {
          id: data.parentCommentId,
          workspace_id: workspaceId,
          task_id: taskId,
          deleted_at: null,
        },
        select: { id: true, parent_comment_id: true },
      });

      if (!parentComment) {
        throw new BadRequestException('Parent comment not found');
      }

      // 2-tier flattening: if parent is already a reply, link to the root parent
      parentCommentId = parentComment.parent_comment_id ?? parentComment.id;
    }

    // Resolve mentions
    let validMentionedUserIds: string[] = [];

    if (Array.isArray(data.mentionedUserIds)) {
      const rawIds = data.mentionedUserIds.filter(
        (id): id is string =>
          typeof id === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
      );
      const uniqueIds = Array.from(new Set(rawIds));
      if (uniqueIds.length > 0) {
        const members = await this.prisma.workspace_members.findMany({
          where: {
            workspace_id: workspaceId,
            user_id: { in: uniqueIds },
          },
          select: { user_id: true },
        });
        validMentionedUserIds = members.map((m) => m.user_id);
      }
    } else {
      // Fallback text matching @DisplayName
      const members = await this.prisma.workspace_members.findMany({
        where: { workspace_id: workspaceId },
        include: { users: { select: { id: true, display_name: true } } },
      });

      members.sort((a, b) => b.users.display_name.length - a.users.display_name.length);
      const foundUserIds = new Set<string>();

      for (const m of members) {
        const name = m.users.display_name.trim();
        if (name.length > 0) {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`@${escaped}(?=[\\s,.:;!?]|$)`, 'gu');
          if (regex.test(content)) {
            foundUserIds.add(m.users.id);
          }
        }
      }
      validMentionedUserIds = Array.from(foundUserIds);
    }

    const newComment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.task_comments.create({
        data: {
          workspace_id: workspaceId,
          task_id: taskId,
          author_user_id: userId,
          parent_comment_id: parentCommentId,
          content,
        },
        include: {
          users: { select: { id: true, display_name: true } },
        },
      });

      if (validMentionedUserIds.length > 0) {
        await tx.comment_mentions.createMany({
          data: validMentionedUserIds.map((mentionedId) => ({
            comment_id: created.id,
            workspace_id: workspaceId,
            mentioned_user_id: mentionedId,
            is_read: false,
          })),
        });
      }

      return created;
    });

    // Broadcast realtime event
    this.workspaceGateway.broadcastCommentCreated(
      workspaceId,
      taskId,
      newComment.id,
      newComment.users.display_name,
    );

    // Direct mention notification to mentioned users
    for (const mentionedId of validMentionedUserIds) {
      if (mentionedId !== userId) {
        this.workspaceGateway.sendDirectMention(mentionedId, {
          commentId: newComment.id,
          workspaceId,
          taskId,
          taskTitle: task.title,
          authorName: newComment.users.display_name,
          contentPreview:
            newComment.content.length > 100
              ? `${newComment.content.slice(0, 100)}...`
              : newComment.content,
        });
      }
    }

    return {
      id: newComment.id,
      taskId: newComment.task_id,
      author: {
        id: newComment.users.id,
        displayName: newComment.users.display_name,
      },
      content: newComment.content,
      parentCommentId: newComment.parent_comment_id,
      createdAt: newComment.created_at,
      updatedAt: newComment.updated_at,
      isDeleted: false,
      mentionedUserIds: validMentionedUserIds,
      replies: [],
    };
  }

  async update(userId: string, workspaceId: string, commentId: string, body: unknown) {
    await this.assertMembership(userId, workspaceId, true);

    const comment = await this.prisma.task_comments.findFirst({
      where: {
        id: commentId,
        workspace_id: workspaceId,
        deleted_at: null,
      },
      include: {
        users: { select: { id: true, display_name: true } },
        comment_mentions: { select: { mentioned_user_id: true } },
      },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.author_user_id !== userId) {
      throw new ForbiddenException('Only author can edit comment');
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid request body');
    }

    const data = body as Record<string, unknown>;
    if (typeof data.content !== 'string' || !data.content.trim()) {
      throw new BadRequestException('Content is required');
    }

    const content = data.content.trim();
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new BadRequestException(`Content must not exceed ${MAX_CONTENT_LENGTH} characters`);
    }

    const updated = await this.prisma.task_comments.update({
      where: { id: commentId },
      data: {
        content,
        updated_at: new Date(),
      },
      include: {
        users: { select: { id: true, display_name: true } },
      },
    });

    return {
      id: updated.id,
      taskId: updated.task_id,
      author: {
        id: updated.users.id,
        displayName: updated.users.display_name,
      },
      content: updated.content,
      parentCommentId: updated.parent_comment_id,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
      isDeleted: false,
      mentionedUserIds: comment.comment_mentions.map((m) => m.mentioned_user_id),
    };
  }

  async delete(userId: string, workspaceId: string, commentId: string) {
    const member = await this.assertMembership(userId, workspaceId, true);

    const comment = await this.prisma.task_comments.findFirst({
      where: {
        id: commentId,
        workspace_id: workspaceId,
        deleted_at: null,
      },
      select: { id: true, author_user_id: true },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.author_user_id !== userId && member.role !== 'owner') {
      throw new ForbiddenException('Only author or workspace owner can delete this comment');
    }

    await this.prisma.task_comments.update({
      where: { id: commentId },
      data: { deleted_at: new Date() },
    });

    return { success: true };
  }

  async listMentions(userId: string, statusInput?: string, pageInput?: string) {
    const page = parsePage(pageInput);
    if (statusInput !== undefined && !['unread', 'all'].includes(statusInput)) {
      throw new BadRequestException('Invalid status filter');
    }

    const where = {
      mentioned_user_id: userId,
      workspace_members: { is: { user_id: userId } },
      ...(statusInput === 'unread' ? { is_read: false } : {}),
    };

    const mentions = await this.prisma.comment_mentions.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      include: {
        task_comments: {
          select: {
            id: true,
            content: true,
            task_id: true,
            created_at: true,
            deleted_at: true,
            tasks: { select: { id: true, title: true } },
            users: { select: { id: true, display_name: true } },
          },
        },
        workspaces: { select: { id: true, name: true } },
      },
    });

    const hasNext = mentions.length > PAGE_SIZE;
    const items = mentions.slice(0, PAGE_SIZE).map((m) => ({
      commentId: m.comment_id,
      workspaceId: m.workspace_id,
      workspaceName: m.workspaces.name,
      taskId: m.task_comments.task_id,
      taskTitle: m.task_comments.tasks.title,
      author: {
        id: m.task_comments.users.id,
        displayName: m.task_comments.users.display_name,
      },
      content: m.task_comments.deleted_at ? '[Bình luận đã bị xóa]' : m.task_comments.content,
      isRead: m.is_read,
      createdAt: m.created_at,
    }));

    return {
      items,
      nextPage: hasNext ? page + 1 : null,
    };
  }

  async markMentionRead(userId: string, commentId: string) {
    const mention = await this.prisma.comment_mentions.findUnique({
      where: {
        comment_id_mentioned_user_id: {
          comment_id: commentId,
          mentioned_user_id: userId,
        },
      },
    });

    if (!mention) {
      throw new NotFoundException('Mention not found');
    }

    await this.assertMembership(userId, mention.workspace_id, false);

    await this.prisma.comment_mentions.update({
      where: {
        comment_id_mentioned_user_id: {
          comment_id: commentId,
          mentioned_user_id: userId,
        },
      },
      data: { is_read: true },
    });

    return { success: true };
  }

  async markAllMentionsRead(userId: string) {
    await this.prisma.comment_mentions.updateMany({
      where: {
        mentioned_user_id: userId,
        is_read: false,
        workspace_members: { is: { user_id: userId } },
      },
      data: { is_read: true },
    });

    return { success: true };
  }
}
