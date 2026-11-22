import { Logger, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthService, PublicUser, SESSION_COOKIE } from '../auth/auth.service';
import { PresenceService } from './presence.service';

export interface AuthenticatedSocket extends Socket {
  data: {
    user: PublicUser;
    activeWorkspaceId?: string;
  };
}

function parseCookie(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawVal] = part.split('=');
    const key = rawKey?.trim();
    if (!key) continue;
    result[key] = decodeURIComponent(rawVal.join('=').trim());
  }
  return result;
}

@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests without origin (like native apps or curl/smoke tests) or local origins
      if (!origin || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  },
})
export class WorkspaceGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(WorkspaceGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly presenceService: PresenceService,
  ) {}

  afterInit(server: Server): void {
    // Socket.IO middleware runs BEFORE connection is established and events are processed
    server.use(async (socket, next) => {
      try {
        const cookies = parseCookie(socket.handshake.headers.cookie);
        const token =
          cookies[SESSION_COOKIE] ||
          (socket.handshake.auth?.token as string | undefined) ||
          (socket.handshake.query?.token as string | undefined);

        if (!token) {
          return next(new Error('AUTH_REQUIRED'));
        }

        const user = await this.authService.me(token);
        socket.data.user = user;
        next();
      } catch {
        next(new Error('AUTH_INVALID'));
      }
    });
  }

  onModuleInit(): void {
    this.presenceService.setOnSweepChange((workspaceId) => {
      this.broadcastPresenceState(workspaceId);
    });
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    if (!client.data?.user) {
      client.disconnect(true);
      return;
    }
    await client.join(`user:${client.data.user.id}`);
    this.logger.debug(`Socket connected & authenticated: user=${client.data.user.email} (${client.id})`);
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    const removal = this.presenceService.removeSocket(client.id);
    if (removal && removal.memberLeft) {
      this.broadcastPresenceState(removal.workspaceId);
    }
    this.logger.debug(`Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('workspace:join')
  async handleWorkspaceJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { workspaceId: string },
  ): Promise<{ success: boolean; error?: string }> {
    if (!payload?.workspaceId || !client.data?.user) {
      this.logger.warn('workspace:join failed validation');
      return { success: false, error: 'Invalid workspace join request' };
    }

    const { workspaceId } = payload;
    const userId = client.data.user.id;

    // Check membership in PostgreSQL
    const membership = await this.prisma.workspace_members.findUnique({
      where: {
        workspace_id_user_id: {
          workspace_id: workspaceId,
          user_id: userId,
        },
      },
    });

    if (!membership) {
      return { success: false, error: 'Not a member of this workspace' };
    }

    // Leave prior workspace room if client was previously joined in another one on this socket
    if (client.data.activeWorkspaceId && client.data.activeWorkspaceId !== workspaceId) {
      const prevRemoval = this.presenceService.removeSocket(client.id);
      if (prevRemoval && prevRemoval.memberLeft) {
        this.broadcastPresenceState(prevRemoval.workspaceId);
      }
      await client.leave(`workspace:${client.data.activeWorkspaceId}`);
    }

    client.data.activeWorkspaceId = workspaceId;
    await client.join(`workspace:${workspaceId}`);

    this.presenceService.addSocket(workspaceId, client.data.user, membership.role, client.id);
    this.broadcastPresenceState(workspaceId);

    return { success: true };
  }

  @SubscribeMessage('workspace:leave')
  async handleWorkspaceLeave(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { workspaceId: string },
  ): Promise<{ success: boolean }> {
    if (!payload?.workspaceId) return { success: false };
    const { workspaceId } = payload;

    if (client.data.activeWorkspaceId !== workspaceId) return { success: false };
    await client.leave(`workspace:${workspaceId}`);
    client.data.activeWorkspaceId = undefined;

    const removal = this.presenceService.removeSocket(client.id);
    if (removal && removal.memberLeft) {
      this.broadcastPresenceState(workspaceId);
    }

    return { success: true };
  }

  @SubscribeMessage('cursor:move')
  handleCursorMove(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { workspaceId: string; x: number; y: number },
  ): void {
    if (!payload?.workspaceId || !client.data?.user || client.data.activeWorkspaceId !== payload.workspaceId) return;
    if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;

    // RBAC: Check member role. Viewers are prohibited from broadcasting cursor position
    const role = this.presenceService.getMemberRole(payload.workspaceId, client.data.user.id);
    if (role !== 'owner' && role !== 'editor') return;

    client.to(`workspace:${payload.workspaceId}`).emit('cursor:updated', {
      userId: client.data.user.id,
      displayName: client.data.user.displayName,
      x: payload.x,
      y: payload.y,
    });
  }

  @SubscribeMessage('presence:heartbeat')
  handleHeartbeat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { workspaceId: string },
  ): void {
    if (!payload?.workspaceId || !client.data?.user || client.data.activeWorkspaceId !== payload.workspaceId) return;
    this.presenceService.heartbeat(payload.workspaceId, client.data.user.id);
  }

  async membershipChanged(workspaceId: string, userId: string, role: 'editor' | 'viewer' | null): Promise<void> {
    if (!this.server) return;
    const sockets = await this.server.in(`user:${userId}`).fetchSockets();
    if (role) this.presenceService.updateMemberRole(workspaceId, userId, role);
    for (const socket of sockets) {
      if (socket.data.activeWorkspaceId !== workspaceId) continue;
      if (role) {
        socket.emit('workspace:role-changed', { workspaceId, role });
      } else {
        await socket.leave(`workspace:${workspaceId}`);
        socket.data.activeWorkspaceId = undefined;
        this.presenceService.removeSocket(socket.id);
        socket.emit('workspace:access-revoked', { workspaceId });
      }
    }
    this.broadcastPresenceState(workspaceId);
  }

  broadcastPresenceState(workspaceId: string): void {
    if (!this.server) return;
    const members = this.presenceService.getMembers(workspaceId);
    this.server.to(`workspace:${workspaceId}`).emit('presence:state', { members });
  }

  broadcastTaskMutated(
    workspaceId: string,
    taskId: string,
    action: 'created' | 'updated' | 'status_changed' | 'trashed' | 'restored',
    updatedByUserId: string,
  ): void {
    if (!this.server) return;
    this.server.to(`workspace:${workspaceId}`).emit('task:mutated', {
      workspaceId,
      taskId,
      action,
      updatedByUserId,
    });
  }

  broadcastCanvasBumped(workspaceId: string, canvasVersion: string, updatedByUserId: string): void {
    if (!this.server) return;
    this.server.to(`workspace:${workspaceId}`).emit('canvas:bumped', {
      workspaceId,
      canvasVersion,
      updatedByUserId,
    });
  }

  broadcastCommentCreated(workspaceId: string, taskId: string, commentId: string, authorName: string): void {
    if (!this.server) return;
    this.server.to(`workspace:${workspaceId}`).emit('comment:created', {
      workspaceId,
      taskId,
      commentId,
      authorName,
    });
  }

  sendDirectMention(
    userId: string,
    payload: {
      commentId: string;
      workspaceId: string;
      taskId: string;
      taskTitle: string;
      authorName: string;
      contentPreview: string;
    },
  ): void {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit('mention:notify', payload);
  }
}
