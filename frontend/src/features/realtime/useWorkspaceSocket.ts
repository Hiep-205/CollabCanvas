import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export type PresenceMember = {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  isOnline: boolean;
};

export type CursorPosition = {
  userId: string;
  displayName: string;
  x: number;
  y: number;
};

export type TaskMutatedEvent = {
  workspaceId: string;
  taskId: string;
  action: 'created' | 'updated' | 'status_changed' | 'trashed' | 'restored';
  updatedByUserId: string;
};

export type CanvasBumpedEvent = {
  workspaceId: string;
  canvasVersion: string;
  updatedByUserId: string;
};

export type CommentCreatedEvent = {
  workspaceId: string;
  taskId: string;
  commentId: string;
  authorName: string;
};

export type MentionNotifyEvent = {
  commentId: string;
  workspaceId: string;
  taskId: string;
  taskTitle: string;
  authorName: string;
  contentPreview: string;
};

export type UseWorkspaceSocketOptions = {
  workspaceId?: string | null;
  onPresenceChange?: (members: PresenceMember[]) => void;
  onCursorUpdated?: (cursor: CursorPosition) => void;
  onTaskMutated?: (event: TaskMutatedEvent) => void;
  onCanvasBumped?: (event: CanvasBumpedEvent) => void;
  onWorkspaceRejoined?: () => void;
  onCommentCreated?: (event: CommentCreatedEvent) => void;
  onMentionNotify?: (event: MentionNotifyEvent) => void;
  onAccessRevoked?: () => void;
  onRoleChanged?: (role: 'editor' | 'viewer') => void;
};

export function useWorkspaceSocket({
  workspaceId,
  onPresenceChange,
  onCursorUpdated,
  onTaskMutated,
  onCanvasBumped,
  onWorkspaceRejoined,
  onCommentCreated,
  onMentionNotify,
  onAccessRevoked,
  onRoleChanged,
}: UseWorkspaceSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [onlineMembers, setOnlineMembers] = useState<PresenceMember[]>([]);
  const socketRef = useRef<Socket | null>(null);

  // Keep callback refs fresh without retriggering socket reconnection
  const callbacksRef = useRef({
    onPresenceChange,
    onCursorUpdated,
    onTaskMutated,
    onCanvasBumped,
    onWorkspaceRejoined,
    onCommentCreated,
    onMentionNotify,
    onAccessRevoked,
    onRoleChanged,
  });

  useEffect(() => {
    callbacksRef.current = {
      onPresenceChange,
      onCursorUpdated,
      onTaskMutated,
      onCanvasBumped,
      onWorkspaceRejoined,
      onCommentCreated,
      onMentionNotify,
      onAccessRevoked,
      onRoleChanged,
    };
  });

  useEffect(() => {
    if (!workspaceId) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    // Connect to the /realtime namespace via relative path proxied by Vite
    const socket = io('/realtime', {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;
    let hasJoined = false;

    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('workspace:join', { workspaceId }, (ack?: { success: boolean; error?: string }) => {
        if (ack && !ack.success) {
          console.warn('[WorkspaceSocket] Join rejected:', ack.error);
        }
        if (ack?.success) {
          if (hasJoined) callbacksRef.current.onWorkspaceRejoined?.();
          hasJoined = true;
        }
      });
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('presence:state', (payload: { members: PresenceMember[] }) => {
      setOnlineMembers(payload.members || []);
      callbacksRef.current.onPresenceChange?.(payload.members || []);
    });

    socket.on('cursor:updated', (payload: CursorPosition) => {
      callbacksRef.current.onCursorUpdated?.(payload);
    });

    socket.on('task:mutated', (payload: TaskMutatedEvent) => {
      callbacksRef.current.onTaskMutated?.(payload);
    });

    socket.on('canvas:bumped', (payload: CanvasBumpedEvent) => {
      callbacksRef.current.onCanvasBumped?.(payload);
    });

    socket.on('comment:created', (payload: CommentCreatedEvent) => {
      callbacksRef.current.onCommentCreated?.(payload);
    });

    socket.on('mention:notify', (payload: MentionNotifyEvent) => {
      callbacksRef.current.onMentionNotify?.(payload);
    });

    socket.on('workspace:access-revoked', (payload: { workspaceId: string }) => {
      if (payload.workspaceId !== workspaceId) return;
      setOnlineMembers([]);
      callbacksRef.current.onAccessRevoked?.();
    });

    socket.on('workspace:role-changed', (payload: { workspaceId: string; role: 'editor' | 'viewer' }) => {
      if (payload.workspaceId === workspaceId) callbacksRef.current.onRoleChanged?.(payload.role);
    });

    // Heartbeat every 15 seconds
    const heartbeatTimer = setInterval(() => {
      if (socket.connected) {
        socket.emit('presence:heartbeat', { workspaceId });
      }
    }, 15_000);

    return () => {
      clearInterval(heartbeatTimer);
      if (socket.connected) {
        socket.emit('workspace:leave', { workspaceId });
      }
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setOnlineMembers([]);
    };
  }, [workspaceId]);

  // Throttled cursor sender (~40ms / 25fps)
  const lastCursorSendRef = useRef<number>(0);
  const sendCursorMove = useCallback(
    (x: number, y: number) => {
      if (!socketRef.current || !socketRef.current.connected || !workspaceId) return;
      const now = Date.now();
      if (now - lastCursorSendRef.current < 40) return;
      lastCursorSendRef.current = now;
      socketRef.current.emit('cursor:move', { workspaceId, x, y });
    },
    [workspaceId]
  );

  return {
    isConnected,
    onlineMembers,
    sendCursorMove,
  };
}
