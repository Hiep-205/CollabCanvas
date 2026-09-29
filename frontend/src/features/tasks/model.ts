export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';

export type Task = { id: string; title: string; status: TaskStatus };

export const statusLabels: Record<TaskStatus, string> = {
  TODO: 'Cần làm',
  IN_PROGRESS: 'Đang làm',
  DONE: 'Hoàn thành',
};
