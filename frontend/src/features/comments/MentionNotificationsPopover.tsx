import { Bell, CheckCheck, ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePreferences } from '../../app/Preferences';
import { getUserColor, getInitials } from '../realtime/colorHash';
import type { MentionNotifyEvent } from '../realtime/useWorkspaceSocket';
import { listMentions, markAllMentionsRead, markMentionRead } from './api';
import type { MentionItem } from './api';

export interface MentionNotificationsPopoverProps {
  onOpenTask?: (workspaceId: string, taskId: string) => void;
  lastMentionNotifyEvent?: MentionNotifyEvent | null;
}

function formatNotificationTime(dateString: string): string {
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

export function MentionNotificationsPopover({
  onOpenTask,
  lastMentionNotifyEvent,
}: MentionNotificationsPopoverProps) {
  const { t } = usePreferences();
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const [mentions, setMentions] = useState<MentionItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Load unread count on mount
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await listMentions('unread', 1);
        if (!active) return;
        setUnreadCount(res.items.length);
      } catch {
        // Ignore initial background fetch error
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // Handle incoming realtime mention notification
  useEffect(() => {
    if (!lastMentionNotifyEvent) return;

    const timer = setTimeout(() => {
      setUnreadCount((prev) => prev + 1);

      const newItem: MentionItem = {
        commentId: lastMentionNotifyEvent.commentId,
        workspaceId: lastMentionNotifyEvent.workspaceId,
        workspaceName: '',
        taskId: lastMentionNotifyEvent.taskId,
        taskTitle: lastMentionNotifyEvent.taskTitle,
        author: {
          id: '',
          displayName: lastMentionNotifyEvent.authorName,
        },
        content: lastMentionNotifyEvent.contentPreview,
        isRead: false,
        createdAt: new Date().toISOString(),
      };

      setMentions((prev) => [newItem, ...prev.filter((m) => m.commentId !== newItem.commentId)]);
    }, 0);

    return () => clearTimeout(timer);
  }, [lastMentionNotifyEvent]);

  // Load list when popover opens or filter changes
  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    void (async () => {
      try {
        const res = await listMentions(filter === 'unread' ? 'unread' : 'all', 1);
        if (!active) return;
        setMentions(res.items);
        if (filter === 'unread') {
          setUnreadCount(res.items.length);
        }
      } catch {
        // Handle silently
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [isOpen, filter]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleMarkAllRead = async () => {
    try {
      await markAllMentionsRead();
      setUnreadCount(0);
      setMentions((prev) => prev.map((m) => ({ ...m, isRead: true })));
    } catch {
      // Ignore
    }
  };

  const handleItemClick = async (item: MentionItem) => {
    if (!item.isRead) {
      try {
        await markMentionRead(item.commentId);
        setUnreadCount((prev) => Math.max(0, prev - 1));
        setMentions((prev) =>
          prev.map((m) => (m.commentId === item.commentId ? { ...m, isRead: true } : m)),
        );
      } catch {
        // Continue navigation regardless
      }
    }

    setIsOpen(false);
    if (onOpenTask) {
      onOpenTask(item.workspaceId, item.taskId);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Bell Trigger Button */}
      <button
        type="button"
        aria-label={t('notifications')}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-outline-variant/50 bg-surface-container text-on-surface-variant hover:text-white hover:border-primary/50 transition-all cursor-pointer"
        title={t('notifications')}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center px-1 rounded-full bg-rose-500 text-[10px] font-extrabold text-white shadow-md ring-2 ring-surface animate-in zoom-in-50">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 sm:w-96 rounded-2xl bg-surface-container/95 backdrop-blur-xl border border-outline-variant/50 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="p-3 border-b border-outline-variant/30 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-white">{t('notifications')}</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold">
                  {unreadCount}
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-[11px] text-primary hover:underline font-semibold flex items-center gap-1"
                title={t('markAllRead')}
              >
                <CheckCheck size={13} />
                <span>{t('markAllRead')}</span>
              </button>
            )}
          </div>

          {/* Filter Tabs */}
          <div className="flex border-b border-outline-variant/20 px-3 pt-2 gap-3 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setFilter('unread')}
              className={`pb-2 border-b-2 transition-all ${
                filter === 'unread'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-on-surface-variant hover:text-white'
              }`}
            >
              {t('unreadMentions')} {unreadCount > 0 && `(${unreadCount})`}
            </button>
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`pb-2 border-b-2 transition-all ${
                filter === 'all'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-on-surface-variant hover:text-white'
              }`}
            >
              {t('allMentions')}
            </button>
          </div>

          {/* Mentions List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-outline-variant/15">
            {loading ? (
              <div className="p-6 text-center text-xs text-on-surface-variant">{t('loading')}</div>
            ) : mentions.length === 0 ? (
              <div className="p-8 text-center text-xs text-on-surface-variant/70 italic flex flex-col items-center gap-2">
                <Bell size={24} className="opacity-30" />
                <span>{t('noNotifications')}</span>
              </div>
            ) : (
              mentions.map((item) => {
                const color = getUserColor(item.author.id);

                return (
                  <div
                    key={item.commentId}
                    onClick={() => handleItemClick(item)}
                    className={`p-3 flex items-start gap-2.5 hover:bg-surface-container-high transition-colors cursor-pointer group ${
                      !item.isRead ? 'bg-primary/5' : ''
                    }`}
                  >
                    {/* Avatar */}
                    <div
                      className={`w-7 h-7 rounded-full ${color.bg} text-white font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5 shadow-sm`}
                    >
                      {getInitials(item.author.displayName)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                      <div className="text-xs text-slate-200 leading-snug">
                        <span className="font-bold text-white">{item.author.displayName}</span>{' '}
                        <span className="text-on-surface-variant">{t('mentionedYouIn')}</span>{' '}
                        <span className="font-semibold text-primary">{item.taskTitle}</span>
                        {item.workspaceName && (
                          <span className="text-[10px] text-on-surface-variant/70 ml-1">
                            ({item.workspaceName})
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-on-surface-variant line-clamp-2 italic bg-surface-container/60 p-1.5 rounded-lg border border-outline-variant/10">
                        &ldquo;{item.content}&rdquo;
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-on-surface-variant/60 pt-0.5">
                        <span>{formatNotificationTime(item.createdAt)}</span>
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-primary flex items-center gap-0.5 font-medium">
                          <span>Mở</span>
                          <ExternalLink size={10} />
                        </span>
                      </div>
                    </div>

                    {/* Unread indicator */}
                    {!item.isRead && (
                      <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
