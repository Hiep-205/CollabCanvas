import { useState, useRef, useEffect, useId } from 'react';
import { Crown, Edit3, Eye, Users } from 'lucide-react';
import type { PresenceMember } from './useWorkspaceSocket';
import { getUserColor, getInitials } from './colorHash';

export interface PresenceBarProps {
  members: PresenceMember[];
  currentUserId?: string;
  maxVisible?: number;
  className?: string;
}

export function PresenceBar({
  members = [],
  currentUserId,
  maxVisible = 4,
  className = '',
}: PresenceBarProps) {
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const overflowMenuId = useId();

  // Filter for members that are actively online
  const activeMembers = (members || []).filter((m) => m && m.isOnline !== false);

  // Close overflow popover on outside click or Escape key
  useEffect(() => {
    if (!isOverflowOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (overflowRef.current && !overflowRef.current.contains(event.target as Node)) {
        setIsOverflowOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOverflowOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOverflowOpen]);

  // Gracefully handle empty member list
  if (activeMembers.length === 0) {
    return null;
  }

  const visibleMembers = activeMembers.slice(0, maxVisible);
  const overflowMembers = activeMembers.slice(maxVisible);
  const hasOverflow = overflowMembers.length > 0;

  const renderRoleBadge = (role?: string) => {
    const normalized = (role || 'viewer').toLowerCase();
    if (normalized === 'owner') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">
          <Crown size={10} className="shrink-0" />
          <span>Owner</span>
        </span>
      );
    }
    if (normalized === 'editor') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
          <Edit3 size={10} className="shrink-0" />
          <span>Editor</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/40">
        <Eye size={10} className="shrink-0" />
        <span>Viewer</span>
      </span>
    );
  };

  return (
    <div
      className={`presence-bar flex items-center ${className}`}
      aria-label={`Thành viên trực tuyến (${activeMembers.length})`}
    >
      <div className="flex items-center -space-x-2">
        {visibleMembers.map((member) => {
          const isSelf = Boolean(currentUserId && member.userId === currentUserId);
          const palette = getUserColor(member.userId);
          const initials = getInitials(member.displayName, member.email);

          return (
            <div
              key={member.userId}
              className="relative group focus-within:z-30"
              tabIndex={0}
              role="group"
              aria-label={`${member.displayName || member.email}${isSelf ? ' (Bạn)' : ''}`}
            >
              {/* Avatar circle with active beacon halo */}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ring-2 ring-surface text-white shadow-sm cursor-pointer select-none transition-transform duration-150 group-hover:scale-105 group-hover:z-20 relative presence-active-ring"
                style={{ backgroundColor: palette.hex }}
              >
                <span>{initials}</span>

                {/* Active online status beacon dot */}
                <span
                  className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-surface"
                  title="Đang hoạt động"
                />
              </div>

              {/* Hover / Focus Tooltip Card */}
              <div
                role="tooltip"
                className="absolute top-full mt-2.5 left-1/2 -translate-x-1/2 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-hover:translate-y-0 group-focus-within:translate-y-0 translate-y-1 transition-all duration-150 z-50 min-w-[210px] p-2.5 rounded-xl bg-surface-container-high/95 backdrop-blur-xl border border-outline-variant/60 shadow-2xl text-xs text-on-surface"
              >
                {/* Arrow pointer */}
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-surface-container-high border-t border-l border-outline-variant/60" />

                <div className="flex items-center gap-2.5 mb-2">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] text-white shrink-0 shadow-inner"
                    style={{ backgroundColor: palette.hex }}
                  >
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white truncate flex items-center gap-1.5">
                      <span className="truncate">{member.displayName || 'Thành viên'}</span>
                      {isSelf && (
                        <span className="text-[10px] font-bold text-primary shrink-0">(Bạn)</span>
                      )}
                    </div>
                    <div className="text-[11px] text-on-surface-variant truncate">
                      {member.email}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1.5 border-t border-outline-variant/30 text-[11px]">
                  <div className="flex items-center gap-1 text-emerald-400 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Trực tuyến</span>
                  </div>
                  <div>{renderRoleBadge(member.role)}</div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Overflow badge if more members than maxVisible */}
        {hasOverflow && (
          <div className="relative" ref={overflowRef}>
            <button
              type="button"
              onClick={() => setIsOverflowOpen((prev) => !prev)}
              aria-expanded={isOverflowOpen}
              aria-haspopup="menu"
              aria-controls={overflowMenuId}
              aria-label={`+${overflowMembers.length} thành viên trực tuyến khác`}
              title={`+${overflowMembers.length} thành viên trực tuyến`}
              className="w-8 h-8 rounded-full bg-surface-container-high hover:bg-surface-container-highest border-2 border-surface flex items-center justify-center text-xs font-bold text-on-surface hover:text-white transition-all cursor-pointer relative z-10 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              +{overflowMembers.length}
            </button>

            {/* Overflow popover list */}
            {isOverflowOpen && (
              <div
                id={overflowMenuId}
                role="menu"
                className="absolute top-full mt-2.5 right-0 z-50 w-64 p-2.5 rounded-xl bg-surface-container-high/95 backdrop-blur-xl border border-outline-variant/60 shadow-2xl animate-in fade-in zoom-in-95 text-xs text-on-surface"
              >
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-outline-variant/40 px-1 font-semibold text-white">
                  <div className="flex items-center gap-1.5">
                    <Users size={14} className="text-primary" />
                    <span>Đang trực tuyến ({activeMembers.length})</span>
                  </div>
                </div>

                <div className="max-h-56 overflow-y-auto space-y-1 pr-0.5">
                  {overflowMembers.map((member) => {
                    const isSelf = Boolean(currentUserId && member.userId === currentUserId);
                    const palette = getUserColor(member.userId);
                    const initials = getInitials(member.displayName, member.email);

                    return (
                      <div
                        key={member.userId}
                        className="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-surface-container/70 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                            style={{ backgroundColor: palette.hex }}
                          >
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-white truncate text-xs flex items-center gap-1">
                              <span className="truncate">{member.displayName || 'Thành viên'}</span>
                              {isSelf && (
                                <span className="text-[10px] text-primary font-bold shrink-0">
                                  (Bạn)
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-on-surface-variant truncate">
                              {member.email}
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0">{renderRoleBadge(member.role)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default PresenceBar;
