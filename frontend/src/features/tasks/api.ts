import { api } from '../../app/api';
import type { TaskStatus } from './model';

export type ServerTask = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  blockedReason: string | null;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'normal' | 'high';
  dueAt: string | null;
  assigneeIds: string[];
  sortOrder: string;
  version: string;
  checklist: { id: string; title: string; isDone: boolean; sortOrder: number }[];
};

export const toApiStatus = (status: TaskStatus): ServerTask['status'] =>
  status === 'TODO' ? 'todo' : status === 'DONE' ? 'done' : 'in_progress';
export const fromApiTask = (task: ServerTask) => ({
  id: task.id,
  title: task.title,
  status: (task.status === 'todo' ? 'TODO' : task.status === 'done' ? 'DONE' : 'IN_PROGRESS') as TaskStatus,
  description: task.description,
  blockedReason: task.blockedReason,
  priority: task.priority,
  dueAt: task.dueAt,
  assigneeIds: task.assigneeIds,
  checklist: task.checklist ?? [],
});

const base = (workspaceId: string) => `/workspaces/${workspaceId}/tasks`;

export type TaskFilters = { query?: string; priority?: ServerTask['priority']; due?: 'overdue' | 'today' | 'upcoming' | 'none'; assigneeId?: string };

export async function listAllTasks(workspaceId: string, filters: TaskFilters = {}): Promise<ServerTask[]> {
  const statuses: ServerTask['status'][] = ['todo', 'in_progress', 'done'];
  const columns = await Promise.all(statuses.map(async (status) => {
    const items: ServerTask[] = [];
    for (let page = 1; page <= 1000; page += 1) {
      const params = new URLSearchParams({ status, page: String(page) });
      if (filters.query) params.set('query', filters.query);
      if (filters.priority) params.set('priority', filters.priority);
      if (filters.due) params.set('due', filters.due);
      if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
      const result = await api<{ items: ServerTask[]; nextPage: number | null }>(`${base(workspaceId)}?${params}`);
      items.push(...result.items);
      if (result.nextPage === null) return items;
    }
    throw new Error('Too many task pages');
  }));
  return columns.flat();
}

export const createTask = (workspaceId: string, title: string, status: TaskStatus) =>
  api<ServerTask>(base(workspaceId), { method: 'POST', body: JSON.stringify({ title, status: toApiStatus(status) }) });

export const updateTask = (workspaceId: string, task: ServerTask, changes: Partial<Pick<ServerTask, 'title' | 'status' | 'priority' | 'dueAt' | 'description' | 'blockedReason'>>) =>
  api<ServerTask>(`${base(workspaceId)}/${task.id}`, { method: 'PATCH', body: JSON.stringify({ version: task.version, ...changes }) });

export const getTask = (workspaceId: string, taskId: string) => api<ServerTask>(`${base(workspaceId)}/${taskId}`);
export const updateAssignees = (workspaceId: string, task: ServerTask, userIds: string[]) =>
  api<ServerTask>(`${base(workspaceId)}/${task.id}/assignees`, { method: 'PUT', body: JSON.stringify({ version: task.version, userIds }) });

export const addChecklistItem = (workspaceId: string, task: ServerTask, title: string) =>
  api<ServerTask>(`${base(workspaceId)}/${task.id}/checklist`, { method: 'POST', body: JSON.stringify({ version: task.version, title }) });
export const updateChecklistItem = (workspaceId: string, task: ServerTask, itemId: string, changes: { title?: string; isDone?: boolean }) =>
  api<ServerTask>(`${base(workspaceId)}/${task.id}/checklist/${itemId}`, { method: 'PATCH', body: JSON.stringify({ version: task.version, ...changes }) });
export const removeChecklistItem = (workspaceId: string, task: ServerTask, itemId: string) =>
  api<ServerTask>(`${base(workspaceId)}/${task.id}/checklist/${itemId}`, { method: 'DELETE', body: JSON.stringify({ version: task.version }) });

export type WorkspaceMember = { id: string; displayName: string; email: string; role: 'owner' | 'editor' | 'viewer' };
export async function listAllMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const members: WorkspaceMember[] = [];
  for (let page = 1; page <= 1000; page += 1) {
    const response = await api<{ items: WorkspaceMember[]; nextPage: number | null }>(`/workspaces/${workspaceId}/members?page=${page}`);
    members.push(...response.items);
    if (response.nextPage === null) return members;
  }
  throw new Error('Too many member pages');
}
