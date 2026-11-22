import { MessageSquare, CornerDownRight, Edit2, Trash2, X, Send, AtSign } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePreferences } from '../../app/Preferences';
import { getUserColor, getInitials } from '../realtime/colorHash';
import type { WorkspaceMember } from '../tasks/api';
import { createComment, deleteComment, listComments, updateComment } from './api';
import type { CommentItem } from './api';

export interface TaskCommentsSectionProps {
  workspaceId: string;
  taskId: string;
  canEdit: boolean;
  currentUserId?: string;
  currentUserRole?: string;
  members: WorkspaceMember[];
  lastCommentCreatedEvent?: { taskId: string; commentId: string } | null;
}

function formatCommentTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Vừa xong';
    if (diffMins < 60) return `${diffMins}p trước`;
    if (diffHours < 24) return `${diffHours}h trước`;
    if (diffDays < 7) return `${diffDays} ngày trước`;

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function TaskCommentsSection({
  workspaceId,
  taskId,
  canEdit,
  currentUserId,
  currentUserRole,
  members,
  lastCommentCreatedEvent,
}: TaskCommentsSectionProps) {
  const { t } = usePreferences();
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Composer state
  const [contentDraft, setContentDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<CommentItem | null>(null);
  const [showMentionMenu, setShowMentionMenu] = useState(false);

  // Edit comment state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const fetchComments = useCallback(async () => {
    try {
      const res = await listComments(workspaceId, taskId);
      setComments(res.items);
      setTotalCount(res.totalCount);
      setError(null);
    } catch {
      setError(t('commentFailed'));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, taskId, t]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await listComments(workspaceId, taskId);
        if (!active) return;
        setComments(res.items);
        setTotalCount(res.totalCount);
        setError(null);
      } catch {
        if (!active) return;
        setError(t('commentFailed'));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [workspaceId, taskId, t, lastCommentCreatedEvent]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = contentDraft.trim();
    if (!text || submitting || !canEdit) return;

    setSubmitting(true);
    setError(null);
    try {
      const mentionedUserIds: string[] = [];
      for (const m of members) {
        if (text.includes(`@${m.displayName}`)) {
          mentionedUserIds.push(m.id);
        }
      }

      await createComment(workspaceId, taskId, {
        content: text,
        parentCommentId: replyingTo ? replyingTo.parentCommentId ?? replyingTo.id : null,
        mentionedUserIds: mentionedUserIds.length > 0 ? mentionedUserIds : undefined,
      });

      setContentDraft('');
      setReplyingTo(null);
      await fetchComments();
    } catch {
      setError(t('commentFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartEdit = (comment: CommentItem) => {
    setEditingId(comment.id);
    setEditContent(comment.content);
  };

  const handleSaveEdit = async (commentId: string) => {
    const text = editContent.trim();
    if (!text) return;
    try {
      await updateComment(workspaceId, commentId, text);
      setEditingId(null);
      await fetchComments();
    } catch {
      setError(t('commentFailed'));
    }
  };

  const handleDelete = async (commentId: string) => {
    try {
      await deleteComment(workspaceId, commentId);
      await fetchComments();
    } catch {
      setError(t('commentFailed'));
    }
  };

  const insertMention = (member: WorkspaceMember) => {
    const tag = `@${member.displayName} `;
    setContentDraft((prev) => prev + tag);
    setShowMentionMenu(false);
    textareaRef.current?.focus();
  };

  const renderCommentContent = (content: string, isDeleted: boolean) => {
    if (isDeleted) {
      return <span className="italic text-on-surface-variant/60 text-xs">{t('commentDeleted')}</span>;
    }

    const parts = content.split(/(@[^\s,.:;!?]+)/g);
    return (
      <span className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
        {parts.map((part, i) => {
          if (part.startsWith('@')) {
            return (
              <span key={i} className="text-primary font-semibold">
                {part}
              </span>
            );
          }
          return part;
        })}
      </span>
    );
  };

  const availableMembers = useMemo(
    () => members.filter((m) => m.id !== currentUserId),
    [members, currentUserId],
  );

  return (
    <div className="flex flex-col gap-2.5 pt-3 border-t border-outline-variant/30">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-white text-xs">
          <MessageSquare size={14} className="text-primary" />
          <span>{t('taskComments')}</span>
          <span className="font-mono text-[11px] text-primary/80">({totalCount})</span>
        </div>
      </div>

      {error && (
        <div role="alert" className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">
          {error}
        </div>
      )}

      {/* Comment List */}
      <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
        {loading ? (
          <div className="text-xs text-on-surface-variant text-center py-3">{t('loading')}</div>
        ) : comments.length === 0 ? (
          <div className="text-xs text-on-surface-variant/70 text-center py-3 italic">
            {t('noComments')}
          </div>
        ) : (
          comments.map((root) => {
            const rootColor = getUserColor(root.author.id);
            const isRootAuthor = root.author.id === currentUserId;
            const canDeleteRoot = isRootAuthor || currentUserRole === 'owner';

            return (
              <div
                key={root.id}
                className="flex flex-col gap-1.5 p-2 rounded-xl bg-surface-container border border-outline-variant/20"
              >
                {/* Root Header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div
                      className={`w-5 h-5 rounded-full ${rootColor.bg} text-white font-bold text-[9px] flex items-center justify-center shrink-0`}
                    >
                      {getInitials(root.author.displayName)}
                    </div>
                    <span className="text-xs font-semibold text-slate-200 truncate">
                      {root.author.displayName}
                    </span>
                    <span className="text-[10px] text-on-surface-variant/60 shrink-0">
                      {formatCommentTime(root.createdAt)}
                    </span>
                  </div>

                  {!root.isDeleted && (
                    <div className="flex items-center gap-1 shrink-0">
                      {canEdit && isRootAuthor && editingId !== root.id && (
                        <button
                          type="button"
                          onClick={() => handleStartEdit(root)}
                          className="text-on-surface-variant hover:text-white p-0.5"
                          title={t('editComment')}
                        >
                          <Edit2 size={12} />
                        </button>
                      )}
                      {canEdit && canDeleteRoot && editingId !== root.id && (
                        <button
                          type="button"
                          onClick={() => handleDelete(root.id)}
                          className="text-on-surface-variant hover:text-rose-400 p-0.5"
                          title={t('deleteComment')}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Root Content / Inline Edit */}
                {editingId === root.id ? (
                  <div className="flex flex-col gap-1.5 mt-1">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full bg-surface-container-high border border-outline-variant/40 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-primary/60"
                      rows={2}
                    />
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-2 py-1 text-[11px] text-on-surface-variant hover:text-white"
                      >
                        {t('cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(root.id)}
                        className="px-2.5 py-1 text-[11px] bg-primary text-slate-950 font-bold rounded-md hover:bg-[#82e6d9]"
                      >
                        {t('saveComment')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>{renderCommentContent(root.content, root.isDeleted)}</div>
                )}

                {/* Reply action button */}
                {!root.isDeleted && canEdit && editingId !== root.id && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setReplyingTo(root);
                        textareaRef.current?.focus();
                      }}
                      className="text-[11px] text-primary/80 hover:text-primary font-medium flex items-center gap-1"
                    >
                      <CornerDownRight size={11} />
                      <span>{t('reply')}</span>
                    </button>
                  </div>
                )}

                {/* Child Replies */}
                {root.replies && root.replies.length > 0 && (
                  <div className="ml-3 pl-2 border-l border-outline-variant/30 flex flex-col gap-1.5 mt-1">
                    {root.replies.map((reply) => {
                      const replyColor = getUserColor(reply.author.id);
                      const isReplyAuthor = reply.author.id === currentUserId;
                      const canDeleteReply = isReplyAuthor || currentUserRole === 'owner';

                      return (
                        <div
                          key={reply.id}
                          className="flex flex-col gap-1 p-1.5 rounded-lg bg-surface-container-high/60 border border-outline-variant/15"
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div
                                className={`w-4 h-4 rounded-full ${replyColor.bg} text-white font-bold text-[8px] flex items-center justify-center shrink-0`}
                              >
                                {getInitials(reply.author.displayName)}
                              </div>
                              <span className="text-[11px] font-semibold text-slate-200 truncate">
                                {reply.author.displayName}
                              </span>
                              <span className="text-[9px] text-on-surface-variant/60 shrink-0">
                                {formatCommentTime(reply.createdAt)}
                              </span>
                            </div>

                            {!reply.isDeleted && (
                              <div className="flex items-center gap-1 shrink-0">
                                {canEdit && isReplyAuthor && editingId !== reply.id && (
                                  <button
                                    type="button"
                                    onClick={() => handleStartEdit(reply)}
                                    className="text-on-surface-variant hover:text-white p-0.5"
                                  >
                                    <Edit2 size={11} />
                                  </button>
                                )}
                                {canEdit && canDeleteReply && editingId !== reply.id && (
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(reply.id)}
                                    className="text-on-surface-variant hover:text-rose-400 p-0.5"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {editingId === reply.id ? (
                            <div className="flex flex-col gap-1 mt-1">
                              <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full bg-surface-container border border-outline-variant/40 rounded p-1.5 text-xs text-white focus:outline-none focus:border-primary/60"
                                rows={2}
                              />
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className="px-2 py-0.5 text-[10px] text-on-surface-variant hover:text-white"
                                >
                                  {t('cancel')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveEdit(reply.id)}
                                  className="px-2 py-0.5 text-[10px] bg-primary text-slate-950 font-bold rounded hover:bg-[#82e6d9]"
                                >
                                  {t('saveComment')}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div>{renderCommentContent(reply.content, reply.isDeleted)}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Composer Section */}
      {!canEdit ? (
        <div className="text-[11px] text-on-surface-variant/70 italic text-center p-2 rounded-lg bg-surface-container border border-outline-variant/20">
          {t('commentReadOnly')}
        </div>
      ) : (
        <form onSubmit={handleSend} className="flex flex-col gap-1.5 mt-1">
          {replyingTo && (
            <div className="flex items-center justify-between text-[11px] text-primary bg-primary/10 px-2.5 py-1 rounded-lg border border-primary/20">
              <span className="truncate">
                {t('replyingTo')}: <strong>{replyingTo.author.displayName}</strong>
              </span>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="text-on-surface-variant hover:text-white shrink-0 ml-1"
              >
                <X size={12} />
              </button>
            </div>
          )}

          <div className="relative">
            <textarea
              ref={textareaRef}
              rows={2}
              placeholder={t('commentsPlaceholder')}
              value={contentDraft}
              onChange={(e) => setContentDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              className="w-full bg-surface-container border border-outline-variant/40 rounded-xl p-2.5 text-xs text-white placeholder:text-on-surface-variant/60 focus:outline-none focus:border-primary/60 pr-8 resize-none"
            />

            <button
              type="button"
              onClick={() => setShowMentionMenu((prev) => !prev)}
              title="@Mention"
              className="absolute right-2 top-2.5 text-on-surface-variant hover:text-primary transition-colors p-1"
            >
              <AtSign size={14} />
            </button>

            {/* Mention Member Suggestion Dropdown */}
            {showMentionMenu && (
              <div className="absolute right-0 bottom-full mb-1 z-30 w-48 bg-surface-container-high border border-outline-variant/40 rounded-xl shadow-lg p-1 max-h-36 overflow-y-auto">
                <div className="text-[10px] font-semibold text-on-surface-variant px-2 py-1 uppercase tracking-wider">
                  Thành viên
                </div>
                {availableMembers.length === 0 ? (
                  <div className="text-[11px] text-on-surface-variant/60 px-2 py-1.5">
                    Không có thành viên khác
                  </div>
                ) : (
                  availableMembers.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => insertMention(m)}
                      className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-left text-xs text-slate-200 hover:bg-surface-container cursor-pointer"
                    >
                      <div
                        className={`w-4 h-4 rounded-full ${getUserColor(m.id).bg} text-white font-bold text-[8px] flex items-center justify-center shrink-0`}
                      >
                        {getInitials(m.displayName)}
                      </div>
                      <span className="truncate">{m.displayName}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-on-surface-variant/50">
              Nhấn Enter để gửi, Shift+Enter để xuống dòng
            </span>
            <button
              type="submit"
              disabled={submitting || !contentDraft.trim()}
              className="px-3 py-1.5 bg-primary hover:bg-[#82e6d9] disabled:opacity-40 disabled:hover:bg-primary text-slate-950 font-bold text-xs rounded-lg transition-all flex items-center gap-1 shrink-0"
            >
              <Send size={12} />
              <span>{t('sendComment')}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
