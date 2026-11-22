import { api } from '../../app/api';

export type ActivityEvent = {
  id: string;
  taskId: string;
  taskTitle: string;
  actorUserId: string;
  actorName: string;
  action: 'task_created' | 'task_updated' | 'task_status_changed' | 'task_assignees_changed' | 'checklist_changed' | 'task_trashed' | 'task_restored';
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
};

export function listActivity(workspaceId: string, page: number, taskId?: string) {
  const params = new URLSearchParams({ page: String(page) });
  if (taskId) params.set('taskId', taskId);
  return api<{ items: ActivityEvent[]; nextPage: number | null }>(`/workspaces/${workspaceId}/activity?${params}`);
}
