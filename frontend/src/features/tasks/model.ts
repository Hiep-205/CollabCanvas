export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';

export type Task = { id: string; title: string; status: TaskStatus; description?: string | null; blockedReason?: string | null; priority?: 'low' | 'normal' | 'high'; dueAt?: string | null; assigneeIds?: string[]; checklist?: { id: string; title: string; isDone: boolean; sortOrder: number }[] };

export const statusLabels: Record<TaskStatus, string> = {
  TODO: 'Cần làm',
  IN_PROGRESS: 'Đang làm',
  DONE: 'Hoàn thành',
};
