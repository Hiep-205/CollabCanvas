import { api } from '../../app/api';

export type CommentAuthor = {
  id: string;
  displayName: string;
};

export type CommentItem = {
  id: string;
  taskId: string;
  author: CommentAuthor;
  content: string;
  parentCommentId: string | null;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  mentionedUserIds: string[];
  replies?: CommentItem[];
};

export type CommentListResponse = {
  items: CommentItem[];
  totalCount: number;
};

export const listComments = (workspaceId: string, taskId: string) =>
  api<CommentListResponse>(`/workspaces/${workspaceId}/tasks/${taskId}/comments`);

export const createComment = (
  workspaceId: string,
  taskId: string,
  data: {
    content: string;
    parentCommentId?: string | null;
    mentionedUserIds?: string[];
  },
) =>
  api<CommentItem>(`/workspaces/${workspaceId}/tasks/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateComment = (workspaceId: string, commentId: string, content: string) =>
  api<CommentItem>(`/workspaces/${workspaceId}/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });

export const deleteComment = (workspaceId: string, commentId: string) =>
  api<{ success: boolean }>(`/workspaces/${workspaceId}/comments/${commentId}`, {
    method: 'DELETE',
  });

export type MentionItem = {
  commentId: string;
  workspaceId: string;
  workspaceName: string;
  taskId: string;
  taskTitle: string;
  author: CommentAuthor;
  content: string;
  isRead: boolean;
  createdAt: string;
};

export type MentionListResponse = {
  items: MentionItem[];
  nextPage: number | null;
};

export const listMentions = (status?: 'unread' | 'all', page = 1) => {
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set('status', status);
  return api<MentionListResponse>(`/me/mentions?${params}`);
};

export const markMentionRead = (commentId: string) =>
  api<{ success: boolean }>(`/me/mentions/${commentId}/read`, {
    method: 'PATCH',
  });

export const markAllMentionsRead = () =>
  api<{ success: boolean }>(`/me/mentions/read-all`, {
    method: 'PATCH',
  });
