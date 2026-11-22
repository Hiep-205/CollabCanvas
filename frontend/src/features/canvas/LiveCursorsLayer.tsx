import { useEffect, useMemo, useState } from 'react';
import { useViewport } from '@xyflow/react';
import { getUserColor } from '../realtime/colorHash';
import type { CursorPosition } from '../realtime/useWorkspaceSocket';

export interface CursorState extends CursorPosition {
  lastUpdated?: number;
}

export interface LiveCursorsLayerProps {
  cursors?: Record<string, CursorState> | CursorState[];
  currentUserId?: string;
  onlineMembers?: { userId: string; isOnline?: boolean }[];
  subscribeCursorUpdated?: (callback: (cursor: CursorPosition) => void) => () => void;
  onSubscribeCursorUpdated?: (callback: (cursor: CursorPosition) => void) => () => void;
  workspaceId?: string;
  timeoutMs?: number; // default 4000ms
  fadeMs?: number; // default 3000ms
}

export function LiveCursorsLayer({
  cursors,
  currentUserId,
  onlineMembers,
  subscribeCursorUpdated,
  onSubscribeCursorUpdated,
  workspaceId,
  timeoutMs = 4000,
  fadeMs = 3000,
}: LiveCursorsLayerProps) {
  const { x: vpX, y: vpY, zoom } = useViewport();
  const [internalCursors, setInternalCursors] = useState<Record<string, CursorState>>({});
  const [tick, setTick] = useState(() => Date.now());

  // React pattern: adjust state when workspaceId prop changes without triggering effect cascade
  const [prevWorkspaceId, setPrevWorkspaceId] = useState(workspaceId);
  if (workspaceId !== prevWorkspaceId) {
    setPrevWorkspaceId(workspaceId);
    setInternalCursors({});
  }

  // Subscription listener for high-frequency cursor updates without re-rendering parent page
  useEffect(() => {
    const subscribe = subscribeCursorUpdated || onSubscribeCursorUpdated;
    if (!subscribe) return;

    const unsubscribe = subscribe((cursor: CursorPosition) => {
      if (!cursor || !cursor.userId) return;
      if (currentUserId && cursor.userId === currentUserId) return;

      const now = Date.now();
      setInternalCursors((prev) => {
        const next: Record<string, CursorState> = {};
        for (const [id, c] of Object.entries(prev)) {
          if (!c.lastUpdated || now - c.lastUpdated <= timeoutMs) {
            next[id] = c;
          }
        }
        next[cursor.userId] = {
          ...cursor,
          lastUpdated: now,
        };
        return next;
      });
    });

    return unsubscribe;
  }, [subscribeCursorUpdated, onSubscribeCursorUpdated, currentUserId, timeoutMs]);

  // 1-second interval heartbeat timer for inactivity fading (>3s) and eviction (>4s)
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Compile active visible cursors (supports controlled `cursors` prop or subscribed `internalCursors`)
  const activeCursors = useMemo(() => {
    const list: CursorState[] = cursors
      ? Array.isArray(cursors)
        ? cursors
        : Object.values(cursors)
      : Object.values(internalCursors);

    const now = tick;
    const onlineIds = onlineMembers
      ? new Set(onlineMembers.filter((m) => m.isOnline !== false).map((m) => m.userId))
      : null;

    return list.filter((cursor) => {
      if (!cursor || !cursor.userId) return false;
      // Self-filter: never render local user's own cursor
      if (currentUserId && cursor.userId === currentUserId) return false;
      // Evict if not online (when onlineMembers is provided)
      if (onlineIds && !onlineIds.has(cursor.userId)) return false;
      // Inactivity cleanup: evict cursors older than timeoutMs
      if (cursor.lastUpdated && now - cursor.lastUpdated > timeoutMs) return false;
      return true;
    });
  }, [cursors, internalCursors, currentUserId, onlineMembers, timeoutMs, tick]);

  return (
    <div
      className="react-flow__live-cursors-layer absolute inset-0 pointer-events-none overflow-hidden z-20"
      aria-hidden="true"
    >
      {activeCursors.map((cursor) => {
        // Dynamic viewport projection: screenX = cursor.x * zoom + vpX, screenY = cursor.y * zoom + vpY
        const screenX = cursor.x * zoom + vpX;
        const screenY = cursor.y * zoom + vpY;
        const isFading = cursor.lastUpdated ? tick - cursor.lastUpdated > fadeMs : false;
        const color = getUserColor(cursor.userId);

        return (
          <div
            key={cursor.userId}
            className={`absolute top-0 left-0 pointer-events-none select-none ${
              isFading ? 'opacity-0' : 'opacity-100'
            }`}
            style={{
              transform: `translate3d(${screenX}px, ${screenY}px, 0)`,
              transition: 'transform 50ms linear, opacity 500ms ease-out',
              willChange: 'transform, opacity',
              opacity: isFading ? 0 : 1,
            }}
          >
            {/* Fixed 24x24 px SVG cursor pointer icon invariant under zoom (0.2x to 2.0x) with tip at (0, 0) */}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="drop-shadow-md pointer-events-none"
            >
              <path
                d="M0 0L0 16L4.5 12L8.5 20.5L11.5 19L7.5 10.5L13.5 10.5L0 0Z"
                fill={color.hex}
                stroke="#ffffff"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>

            {/* Rounded pill name tag beside pointer (left-3.5 top-3.5) with dark glassmorphic styling */}
            <div
              className="absolute left-3.5 top-3.5 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium tracking-tight whitespace-nowrap shadow-lg select-none backdrop-blur-md pointer-events-none"
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                borderColor: 'rgba(255, 255, 255, 0.15)',
                borderWidth: '1px',
                borderStyle: 'solid',
                color: '#ffffff',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
                ...({ backdropBlur: '8px' } as Record<string, string>),
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: color.hex }}
              />
              <span>{cursor.displayName || 'Anonymous'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default LiveCursorsLayer;
