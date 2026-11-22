import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

export type MemberPresence = {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  lastPing: number;
  socketIds: Set<string>;
};

export type PresenceStateItem = {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  isOnline: boolean;
};

@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  // workspaceId -> (userId -> MemberPresence)
  private readonly workspacePresence = new Map<string, Map<string, MemberPresence>>();

  // socketId -> { workspaceId, userId }
  private readonly socketMap = new Map<string, { workspaceId: string; userId: string }>();

  private sweeperInterval: NodeJS.Timeout | null = null;
  private onSweepChangeCallback?: (workspaceId: string) => void;

  onModuleInit(): void {
    // 30-second sweeper loop to clean up zombie / half-open sockets
    this.sweeperInterval = setInterval(() => {
      this.sweepZombieSockets();
    }, 30_000);
    this.sweeperInterval.unref();
  }

  onModuleDestroy(): void {
    if (this.sweeperInterval) {
      clearInterval(this.sweeperInterval);
      this.sweeperInterval = null;
    }
  }

  setOnSweepChange(callback: (workspaceId: string) => void): void {
    this.onSweepChangeCallback = callback;
  }

  addSocket(
    workspaceId: string,
    user: { id: string; displayName: string; email: string },
    role: string,
    socketId: string,
  ): void {
    let membersMap = this.workspacePresence.get(workspaceId);
    if (!membersMap) {
      membersMap = new Map<string, MemberPresence>();
      this.workspacePresence.set(workspaceId, membersMap);
    }

    let member = membersMap.get(user.id);
    if (!member) {
      member = {
        userId: user.id,
        displayName: user.displayName,
        email: user.email,
        role,
        lastPing: Date.now(),
        socketIds: new Set<string>(),
      };
      membersMap.set(user.id, member);
    }

    member.socketIds.add(socketId);
    member.lastPing = Date.now();
    member.role = role; // update latest role if changed
    this.socketMap.set(socketId, { workspaceId, userId: user.id });
  }

  removeSocket(socketId: string): { workspaceId: string; memberLeft: boolean } | null {
    const entry = this.socketMap.get(socketId);
    if (!entry) return null;
    this.socketMap.delete(socketId);

    const { workspaceId, userId } = entry;
    const membersMap = this.workspacePresence.get(workspaceId);
    if (!membersMap) return null;

    const member = membersMap.get(userId);
    if (!member) return null;

    member.socketIds.delete(socketId);
    let memberLeft = false;

    if (member.socketIds.size === 0) {
      membersMap.delete(userId);
      memberLeft = true;
    }

    if (membersMap.size === 0) {
      this.workspacePresence.delete(workspaceId);
    }

    return { workspaceId, memberLeft };
  }

  heartbeat(workspaceId: string, userId: string): void {
    const membersMap = this.workspacePresence.get(workspaceId);
    if (!membersMap) return;
    const member = membersMap.get(userId);
    if (member) {
      member.lastPing = Date.now();
    }
  }

  getMemberRole(workspaceId: string, userId: string): string | null {
    const membersMap = this.workspacePresence.get(workspaceId);
    if (!membersMap) return null;
    const member = membersMap.get(userId);
    return member ? member.role : null;
  }

  updateMemberRole(workspaceId: string, userId: string, role: string): void {
    const member = this.workspacePresence.get(workspaceId)?.get(userId);
    if (member) member.role = role;
  }

  getMembers(workspaceId: string): PresenceStateItem[] {
    const membersMap = this.workspacePresence.get(workspaceId);
    if (!membersMap) return [];
    const result: PresenceStateItem[] = [];
    for (const member of membersMap.values()) {
      result.push({
        userId: member.userId,
        displayName: member.displayName,
        email: member.email,
        role: member.role,
        isOnline: member.socketIds.size > 0,
      });
    }
    return result;
  }

  sweepZombieSockets(timeoutMs = 30_000): string[] {
    const now = Date.now();
    const affectedWorkspaces: string[] = [];

    for (const [workspaceId, membersMap] of this.workspacePresence.entries()) {
      let hasChanges = false;
      for (const [userId, member] of membersMap.entries()) {
        if (now - member.lastPing > timeoutMs) {
          // Remove all socketIds from reverse socketMap
          for (const sId of member.socketIds) {
            this.socketMap.delete(sId);
          }
          membersMap.delete(userId);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        affectedWorkspaces.push(workspaceId);
        if (this.onSweepChangeCallback) {
          this.onSweepChangeCallback(workspaceId);
        }
      }

      if (membersMap.size === 0) {
        this.workspacePresence.delete(workspaceId);
      }
    }

    return affectedWorkspaces;
  }
}
