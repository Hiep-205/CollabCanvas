import { api } from '../../app/api';

export type TrashItem =
  | { type: 'task'; id: string; title: string; deletedAt: string; version: string }
  | { type: 'note'; id: string; text: string | null; deletedAt: string; parentTaskDeleted: boolean };

export type TrashPage = { items: TrashItem[]; nextPage: number | null; canvasVersion: string };

export const listTrash = (workspaceId: string, type: 'tasks' | 'notes', page = 1) =>
  api<TrashPage>(`/workspaces/${workspaceId}/trash?type=${type}&page=${page}`);

export const changeTaskTrash = (workspaceId: string, taskId: string, version: string, deleted: boolean) =>
  api<{ id: string; version: string; canvasVersion: string }>(`/workspaces/${workspaceId}/trash/tasks/${taskId}`,
    { method: 'PATCH', body: JSON.stringify({ version, deleted }) });

export const changeNoteTrash = (workspaceId: string, noteId: string, version: string, deleted: boolean) =>
  api<{ id: string; canvasVersion: string }>(`/workspaces/${workspaceId}/trash/notes/${noteId}`,
    { method: 'PATCH', body: JSON.stringify({ version, deleted }) });
