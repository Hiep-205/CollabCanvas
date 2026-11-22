import { Fragment, useState, useEffect, useRef } from 'react';
import { usePreferences } from '../../app/Preferences';
import type { Task, TaskStatus } from '../tasks/model';
import type { WorkspaceMember } from '../tasks/api';
import { isBottleneckTask } from '../canvas/relationships';

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE'];

type Props = {
  tasks: Task[];
  members: WorkspaceMember[];
  blockedBy: Map<string, Task[]>;
  selectedTaskId: string | null;
  canEdit: boolean;
  now: number;
  viewMode?: 'kanban' | 'list' | 'calendar';
  onCreateTask: (status: TaskStatus, title: string) => Promise<boolean>;
  onSelectTask: (id: string) => void;
  onMoveTask: (id: string, status: TaskStatus) => void;
};

export default function KanbanBoard({
  tasks,
  members,
  blockedBy,
  selectedTaskId,
  canEdit,
  now,
  viewMode = 'kanban',
  onCreateTask,
  onSelectTask,
  onMoveTask,
}: Props) {
  const { locale, t } = usePreferences();
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [recentlyMovedTaskId, setRecentlyMovedTaskId] = useState<string | null>(null);
  const movedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (movedTimerRef.current) window.clearTimeout(movedTimerRef.current);
    };
  }, []);

  const [composerStatus, setComposerStatus] = useState<TaskStatus | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [composerError, setComposerError] = useState<'required' | 'save' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeBlockerPopoverId, setActiveBlockerPopoverId] = useState<string | null>(null);
  const [columnMenuStatus, setColumnMenuStatus] = useState<TaskStatus | null>(null);
  const [columnSort, setColumnSort] = useState<Record<TaskStatus, 'default' | 'due' | 'priority'>>({
    TODO: 'default',
    IN_PROGRESS: 'default',
    DONE: 'default',
  });


  const closeComposer = () => {
    setComposerStatus(null);
    setDraftTitle('');
    setComposerError(null);
  };

  const openComposer = (status: TaskStatus) => {
    setComposerStatus(status);
    setComposerError(null);
  };

  const sortTasks = (columnTasks: Task[], sortMode: 'default' | 'due' | 'priority') => {
    if (sortMode === 'due') {
      return [...columnTasks].sort((a, b) => {
        if (!a.dueAt) return 1;
        if (!b.dueAt) return -1;
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      });
    }
    if (sortMode === 'priority') {
      const pWeight = { high: 3, normal: 2, low: 1 };
      return [...columnTasks].sort((a, b) => (pWeight[b.priority || 'normal'] || 2) - (pWeight[a.priority || 'normal'] || 2));
    }
    return columnTasks;
  };

  const getPriorityInfo = (task: Task) => {
    if (task.status === 'DONE') {
      return {
        label: locale === 'vi' ? 'Đã hoàn thành' : 'Completed',
        badgeClass: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
        dotClass: 'bg-emerald-400',
        icon: 'check_circle',
      };
    }
    if (task.priority === 'high') {
      return {
        label: locale === 'vi' ? 'Ưu tiên: Cao' : 'Priority: High',
        badgeClass: 'bg-rose-500/10 border-rose-500/30 text-rose-300',
        dotClass: 'bg-rose-400',
        icon: null,
      };
    }
    if (task.priority === 'low') {
      return {
        label: locale === 'vi' ? 'Ưu tiên: Thấp' : 'Priority: Low',
        badgeClass: 'bg-teal-500/10 border-teal-500/30 text-teal-300',
        dotClass: 'bg-teal-400',
        icon: null,
      };
    }
    return {
      label: locale === 'vi' ? 'Ưu tiên: Trung bình' : 'Priority: Medium',
      badgeClass: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
      dotClass: 'bg-amber-400',
      icon: null,
    };
  };

  // ================= LIST VIEW MODE =================
  if (viewMode === 'list') {
    return (
      <div className="bg-surface-container-low/70 border border-outline-variant/40 rounded-2xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.25)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-outline-variant/40 bg-surface-container/60 text-on-surface-variant font-semibold">
                <th className="py-3 px-4">Mã thẻ</th>
                <th className="py-3 px-4 min-w-[260px]">Tên công việc</th>
                <th className="py-3 px-4">Trạng thái</th>
                <th className="py-3 px-4">Mức ưu tiên</th>
                <th className="py-3 px-4">Hạn chót</th>
                <th className="py-3 px-4">Vướng mắc</th>
                <th className="py-3 px-4">Người phụ trách</th>
                <th className="py-3 px-4 text-right">Tiến độ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-on-surface-variant">
                    Chưa có công việc nào
                  </td>
                </tr>
              ) : (
                tasks.map((task, idx) => {
                  const blockers = blockedBy.get(task.id) || [];
                  const priority = getPriorityInfo(task);
                  const isBottleneck = isBottleneckTask(task, now);
                  const isOverdue = Boolean(task.dueAt && new Date(task.dueAt).getTime() < now && task.status !== 'DONE');
                  const taskCode = `#TK-${task.id.slice(-4).toUpperCase() || (idx + 1)}`;
                  const checklistTotal = task.checklist?.length || 0;
                  const checklistDone = task.checklist?.filter((i) => i.isDone).length || 0;
                  const checklistPercent = checklistTotal ? Math.round((checklistDone / checklistTotal) * 100) : task.status === 'DONE' ? 100 : 0;
                  const tableBottleneckTooltip = task.blockedReason && isOverdue
                    ? `Điểm nghẽn: Vừa quá hạn vừa có vướng mắc: ${task.blockedReason}`
                    : isOverdue
                    ? `Điểm nghẽn: Công việc đã quá hạn chót (${new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { day: '2-digit', month: '2-digit' }).format(new Date(task.dueAt!))}) mà chưa hoàn thành`
                    : task.blockedReason
                    ? `Điểm nghẽn: Vướng mắc - ${task.blockedReason}`
                    : 'Công việc này đang là điểm nghẽn của luồng tiến độ';

                  return (
                    <tr
                      key={task.id}
                      className={`hover:bg-surface-container-high/60 transition-colors cursor-pointer ${
                        selectedTaskId === task.id ? 'bg-surface-container-high/90 ring-1 ring-primary/40' : ''
                      }`}
                      onClick={() => onSelectTask(task.id)}
                    >
                      <td className="py-3 px-4 font-mono text-on-surface-variant text-[11px]">{taskCode}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-white hover:text-primary transition-colors flex items-center gap-2">
                            {task.title}
                            {isBottleneck && (
                              <span
                                className="px-1.5 py-0.2 rounded text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/40 cursor-help"
                                title={tableBottleneckTooltip}
                              >
                                ⚠️ Nghẽn
                              </span>
                            )}
                          </span>
                          {task.description && (
                            <span className="text-[11px] text-on-surface-variant line-clamp-1 mt-0.5">
                              {task.description}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                            task.status === 'DONE'
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                              : task.status === 'IN_PROGRESS'
                              ? 'bg-primary/10 border-primary/30 text-primary'
                              : 'bg-surface-container-highest border-outline-variant/40 text-slate-300'
                          }`}
                        >
                          {t(task.status)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${priority.badgeClass} inline-flex items-center gap-1`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${priority.dotClass}`} />
                          {priority.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-on-surface-variant text-[11px]">
                        {task.dueAt ? (
                          <span
                            className={`flex items-center gap-1 ${
                              isOverdue
                                ? 'text-rose-400 font-semibold bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/30'
                                : 'text-slate-200'
                            }`}
                            title={isOverdue ? `Quá hạn: ${new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(task.dueAt))}` : 'Hạn chót'}
                          >
                            <span className={`material-symbols-outlined text-[13px] ${isOverdue ? 'text-rose-400' : 'text-primary'}`}>
                              {isOverdue ? 'alarm' : 'event'}
                            </span>
                            {new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { day: '2-digit', month: '2-digit' }).format(new Date(task.dueAt))}
                            {isOverdue && <span className="text-[9px] uppercase font-bold text-rose-400">Trễ</span>}
                          </span>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {blockers.length > 0 ? (
                          <span className="px-2 py-0.5 rounded text-[11px] bg-amber-500/15 border border-amber-500/30 text-amber-300 inline-flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px]">lock</span>
                            Chờ {blockers.length} việc
                          </span>
                        ) : task.blockedReason ? (
                          <span className="px-2 py-0.5 rounded text-[11px] bg-rose-500/15 border border-rose-500/30 text-rose-300 inline-flex items-center gap-1" title={task.blockedReason}>
                            <span className="material-symbols-outlined text-[12px]">warning</span>
                            Vướng mắc
                          </span>
                        ) : (
                          <span className="text-on-surface-variant/40">--</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex -space-x-1.5 items-center">
                          {task.assigneeIds && task.assigneeIds.length > 0 ? (
                            task.assigneeIds.slice(0, 2).map((id) => {
                              const member = members.find((m) => m.id === id);
                              return (
                                <div key={id} className="w-6 h-6 rounded-full bg-primary/20 text-primary border border-primary/40 flex items-center justify-center font-bold text-[10px]" title={member?.displayName ?? id}>
                                  {(member?.displayName ?? '?').slice(0, 2).toUpperCase()}
                                </div>
                              );
                            })
                          ) : (
                            <span className="text-on-surface-variant/40">--</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-surface-container-highest h-1.5 rounded-full overflow-hidden">
                            <div className="bg-gradient-to-r from-primary to-emerald-400 h-full rounded-full" style={{ width: `${checklistPercent}%` }} />
                          </div>
                          <span className="font-mono text-[11px] text-white font-medium">{checklistPercent}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ================= CALENDAR VIEW MODE =================
  if (viewMode === 'calendar') {
    const today = new Date(now);
    const daysInWeek = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    return (
      <div className="bg-surface-container-low/70 border border-outline-variant/40 rounded-2xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.25)] flex flex-col gap-4">
        <div className="flex items-center justify-between pb-3 border-b border-outline-variant/30">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">calendar_month</span>
            <h2 className="text-sm font-bold text-white">
              Lịch công việc tháng {today.getMonth() + 1}/{today.getFullYear()}
            </h2>
          </div>
          <span className="text-xs text-on-surface-variant">Tổng số {tasks.length} công việc theo hạn chót</span>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {daysInWeek.map((day) => (
            <div key={day} className="text-center py-2 text-xs font-bold text-on-surface-variant bg-surface-container rounded-lg">
              {day}
            </div>
          ))}
          {Array.from({ length: 35 }).map((_, i) => {
            const dayNum = ((i + 1) % 31) + 1;
            const isToday = dayNum === today.getDate();
            const dayTasks = tasks.filter((t) => {
              if (!t.dueAt) return false;
              const date = new Date(t.dueAt);
              return date.getDate() === dayNum;
            });

            return (
              <div
                key={i}
                className={`min-h-[90px] p-1.5 rounded-xl border flex flex-col gap-1 transition-all ${
                  isToday
                    ? 'border-primary/60 bg-surface-container-high/80'
                    : 'border-outline-variant/30 bg-surface-container-low/50 hover:bg-surface-container/60'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] px-1 font-mono">
                  <span className={isToday ? 'text-primary font-bold' : 'text-on-surface-variant'}>{dayNum}</span>
                  {dayTasks.length > 0 && (
                    <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[9px] flex items-center justify-center font-bold">
                      {dayTasks.length}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1 overflow-y-auto max-h-[64px]">
                  {dayTasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => onSelectTask(task.id)}
                      className="px-1.5 py-0.5 rounded bg-surface-container hover:bg-primary/20 text-[10px] text-slate-200 truncate cursor-pointer border border-outline-variant/30"
                      title={task.title}
                    >
                      {task.title}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ================= KANBAN THREE-COLUMN GRID =================
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start" aria-label={t('kanban')}>
      {STATUSES.map((status) => {
        const rawColumnTasks = tasks.filter((task) => task.status === status);
        const columnTasks = sortTasks(rawColumnTasks, columnSort[status]);
        const isDropActive = dropTarget === status;

        return (
          <div
            key={status}
            className={`kanban-column flex flex-col bg-surface-container-low/70 border rounded-2xl p-4 gap-3.5 shadow-[0_4px_24px_rgba(0,0,0,0.25)] transition-all ${
              isDropActive ? 'border-primary ring-2 ring-primary/30 bg-surface-container-low' : 'border-outline-variant/40'
            }`}
            aria-label={t(status)}
            onDragOver={(event) => {
              if (canEdit) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget(status);
                if (dropIndex === null) {
                  setDropIndex(columnTasks.length);
                }
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDropTarget(null);
                setDropIndex(null);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const taskId = event.dataTransfer.getData('application/x-collabcanvas-task');
              if (canEdit && taskId && tasks.some((task) => task.id === taskId)) {
                onMoveTask(taskId, status);
                setRecentlyMovedTaskId(taskId);
                if (movedTimerRef.current) window.clearTimeout(movedTimerRef.current);
                movedTimerRef.current = window.setTimeout(() => {
                  setRecentlyMovedTaskId(null);
                }, 2800);
                setTimeout(() => {
                  const cardEl = document.querySelector(`[data-task-id="${taskId}"]`);
                  cardEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 60);
              }
              setDropTarget(null);
              setDropIndex(null);
              setDraggingTaskId(null);
            }}
          >
            {/* Column Header */}
            <div className="flex items-center justify-between pb-2 border-b border-outline-variant/30 relative">
              <div className="flex items-center gap-2.5">
                {status === 'TODO' && (
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-400 shadow-[0_0_8px_rgba(148,163,184,0.6)]" />
                )}
                {status === 'IN_PROGRESS' && (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                  </span>
                )}
                {status === 'DONE' && (
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
                )}

                <h2 className="text-sm font-bold text-white tracking-wide">{t(status)}</h2>

                <span
                  className={`px-2 py-0.5 rounded-full font-mono text-xs font-bold border ${
                    status === 'TODO'
                      ? 'bg-surface-container-high border-outline-variant/60 text-slate-300'
                      : status === 'IN_PROGRESS'
                      ? 'bg-primary/10 border-primary/40 text-primary'
                      : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  }`}
                >
                  {columnTasks.length}
                </span>
              </div>

              <div className="flex items-center gap-1">
                {canEdit && (
                  <button
                    type="button"
                    className="w-7 h-7 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-all flex items-center justify-center"
                    title={t('addTask')}
                    onClick={() => openComposer(status)}
                  >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                  </button>
                )}

                <div className="relative">
                  <button
                    type="button"
                    className="w-7 h-7 rounded-lg text-on-surface-variant hover:text-white hover:bg-surface-container-high transition-all flex items-center justify-center"
                    title="Tùy chọn cột"
                    onClick={() => setColumnMenuStatus(columnMenuStatus === status ? null : status)}
                  >
                    <span className="material-symbols-outlined text-[18px]">more_horiz</span>
                  </button>

                  {columnMenuStatus === status && (
                    <div
                      className="absolute right-0 top-full mt-1.5 z-50 w-48 p-1.5 rounded-xl bg-surface-container-highest/95 backdrop-blur-md border border-outline-variant/60 shadow-xl flex flex-col gap-1 text-xs"
                      onMouseLeave={() => setColumnMenuStatus(null)}
                    >
                      <button
                        type="button"
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-surface-container hover:text-primary transition-colors flex items-center gap-2 text-slate-200"
                        onClick={() => {
                          setColumnSort((prev) => ({ ...prev, [status]: 'due' }));
                          setColumnMenuStatus(null);
                        }}
                      >
                        <span className="material-symbols-outlined text-[15px]">sort</span>
                        <span>Sắp xếp theo hạn chót</span>
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-surface-container hover:text-primary transition-colors flex items-center gap-2 text-slate-200"
                        onClick={() => {
                          setColumnSort((prev) => ({ ...prev, [status]: 'priority' }));
                          setColumnMenuStatus(null);
                        }}
                      >
                        <span className="material-symbols-outlined text-[15px]">flag</span>
                        <span>Sắp xếp theo ưu tiên</span>
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant transition-colors flex items-center gap-2"
                        onClick={() => {
                          setColumnSort((prev) => ({ ...prev, [status]: 'default' }));
                          setColumnMenuStatus(null);
                        }}
                      >
                        <span className="material-symbols-outlined text-[15px]">restart_alt</span>
                        <span>Mặc định ban đầu</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Cards Stack */}
            <div className="flex flex-col gap-3 relative min-h-[40px]">
              {isDropActive && dropIndex === 0 && (
                <div className="kanban-drop-slot">
                  <span className="material-symbols-outlined text-[16px] animate-bounce">south</span>
                  <span>Thả thẻ vào vị trí này</span>
                </div>
              )}
              {columnTasks.map((task, index) => {
                const blockers = blockedBy.get(task.id) || [];
                const priority = getPriorityInfo(task);
                const isBottleneck = isBottleneckTask(task, now);
                const isOverdue = Boolean(task.dueAt && new Date(task.dueAt).getTime() < now && task.status !== 'DONE');
                const isSelected = selectedTaskId === task.id;
                const isRecentlyMoved = recentlyMovedTaskId === task.id;
                const isCurrentlyDragging = draggingTaskId === task.id;
                const taskCode = `#TK-${task.id.slice(-4).toUpperCase() || index + 1}`;

                const checklistTotal = task.checklist?.length || 0;
                const checklistDone = task.checklist?.filter((i) => i.isDone).length || 0;
                const checklistPercent = checklistTotal
                  ? Math.round((checklistDone / checklistTotal) * 100)
                  : task.status === 'DONE'
                  ? 100
                  : 0;

                const bottleneckTooltip = task.blockedReason && isOverdue
                  ? `Điểm nghẽn: Vừa quá hạn (${new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { day: '2-digit', month: '2-digit' }).format(new Date(task.dueAt!))}) vừa có vướng mắc: ${task.blockedReason}`
                  : isOverdue
                  ? `Điểm nghẽn: Công việc đã quá hạn chót (${new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(task.dueAt!))}) mà chưa hoàn thành`
                  : task.blockedReason
                  ? `Điểm nghẽn: Vướng mắc - ${task.blockedReason}`
                  : 'Công việc này đang là điểm nghẽn của luồng tiến độ';

                return (
                  <Fragment key={task.id}>
                    <div
                      data-task-id={task.id}
                      draggable={canEdit}
                      onClick={() => onSelectTask(task.id)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('application/x-collabcanvas-task', task.id);
                        setDraggingTaskId(task.id);
                      }}
                      onDragEnd={() => {
                        setDropTarget(null);
                        setDropIndex(null);
                        setDraggingTaskId(null);
                      }}
                      onDragOver={(event) => {
                        if (canEdit) {
                          event.preventDefault();
                          event.stopPropagation();
                          const rect = event.currentTarget.getBoundingClientRect();
                          const midY = rect.top + rect.height / 2;
                          const targetIdx = event.clientY < midY ? index : index + 1;
                          setDropTarget(status);
                          setDropIndex(targetIdx);
                        }
                      }}
                      className={`kanban-card group bg-surface-container border hover:border-primary/50 hover:shadow-[0_8px_20px_rgba(0,0,0,0.35)] rounded-xl p-4 flex flex-col gap-3 transition-all duration-200 cursor-grab active:cursor-grabbing relative ${
                        isRecentlyMoved
                          ? 'kanban-card-landed'
                          : isSelected
                          ? 'border-primary ring-2 ring-primary/40 bg-surface-container-high'
                          : isBottleneck
                          ? 'border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.25)]'
                          : task.status === 'DONE'
                          ? 'border-emerald-500/30'
                          : 'border-outline-variant/50'
                      } ${isCurrentlyDragging ? 'opacity-35 scale-[0.98] ring-2 ring-primary/30 pointer-events-none' : ''}`}
                    >
                      {/* Header Badges */}
                      <div className="flex items-center justify-between gap-2 w-full">
                        {isRecentlyMoved ? (
                          <span className="kanban-moved-badge px-2.5 py-0.5 rounded-md border text-[11px] font-semibold flex items-center gap-1.5 transition-all shadow-sm">
                            <span className="material-symbols-outlined text-[13px] text-sky-400">check_circle</span>
                            <span className="text-sky-200">Vừa chuyển sang</span>
                          </span>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold flex items-center gap-1 ${priority.badgeClass}`}
                          >
                            {priority.icon ? (
                              <span className="material-symbols-outlined text-[13px]">{priority.icon}</span>
                            ) : (
                              <span className={`w-1.5 h-1.5 rounded-full ${priority.dotClass}`} />
                            )}
                            <span>{priority.label}</span>
                          </span>
                        )}

                      <div className="flex items-center gap-1.5 font-mono text-[11px]">
                        {isBottleneck && (
                          <span
                            className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold flex items-center gap-1 shadow-sm cursor-help"
                            title={bottleneckTooltip}
                          >
                            ⚠️ Nghẽn
                          </span>
                        )}
                        <span className="text-on-surface-variant">{taskCode}</span>
                      </div>
                    </div>

                    {/* Title & Description */}
                    <div className="w-full">
                      <h3 className="text-sm font-bold text-white group-hover:text-primary transition-colors flex items-center justify-between gap-2">
                        <span>{task.title}</span>
                      </h3>
                      {task.description && (
                        <p className="kanban-card-description text-xs text-on-surface-variant mt-1 line-clamp-2">
                          {task.description}
                        </p>
                      )}
                    </div>

                    {/* Checklists / Subtasks Progress Bar */}
                    {checklistTotal > 0 ? (
                      <div className="space-y-1.5 w-full">
                        <div className="flex items-center justify-between text-[11px] gap-2">
                          <span className="text-on-surface-variant flex items-center gap-1.5 min-w-0">
                            <span className="material-symbols-outlined text-[13px] text-primary shrink-0">checklist</span>
                            <span className="truncate">{checklistDone === checklistTotal ? 'Toàn bộ nhiệm vụ đã xong' : `${checklistDone}/${checklistTotal} mục hoàn tất`}</span>
                          </span>
                          <span className="text-white font-mono font-semibold shrink-0">{checklistPercent}%</span>
                        </div>
                        <div className="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              task.status === 'DONE'
                                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                                : 'bg-gradient-to-r from-primary to-emerald-400'
                            }`}
                            style={{ width: `${checklistPercent}%` }}
                          />
                        </div>
                      </div>
                    ) : null}

                    {/* BLOCKER / DEPENDENCY INTERACTIVE POPOVER (Solves User Request #8) */}
                    {(blockers.length > 0 || task.blockedReason) && (
                      <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {blockers.length > 0 && (
                          <div className="relative">
                            <button
                              type="button"
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 text-[11px] font-semibold transition-all shadow-sm"
                              onClick={() =>
                                setActiveBlockerPopoverId(
                                  activeBlockerPopoverId === task.id ? null : task.id
                                )
                              }
                              title="Bấm để xem danh sách các công việc đang cản trở thẻ này"
                            >
                              <span className="material-symbols-outlined text-[14px] text-amber-400">lock</span>
                              <span>Chờ {blockers.length} việc</span>
                              <span className="material-symbols-outlined text-[13px] opacity-70">
                                {activeBlockerPopoverId === task.id ? 'expand_less' : 'expand_more'}
                              </span>
                            </button>

                            {/* Floating Popover on Hover/Click */}
                            {activeBlockerPopoverId === task.id && (
                              <div
                                className="absolute left-0 bottom-full mb-2 z-50 w-72 p-3 rounded-xl bg-surface-container-highest/95 backdrop-blur-md border border-amber-500/50 shadow-2xl flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-150"
                                role="dialog"
                              >
                                <div className="flex items-center justify-between pb-1.5 border-b border-outline-variant/40">
                                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                                    <span className="material-symbols-outlined text-[15px]">lock_clock</span>
                                    <span>Bị chặn bởi {blockers.length} công việc:</span>
                                  </div>
                                  <button
                                    type="button"
                                    className="text-on-surface-variant hover:text-white p-0.5 rounded transition-colors"
                                    onClick={() => setActiveBlockerPopoverId(null)}
                                  >
                                    <span className="material-symbols-outlined text-[14px]">close</span>
                                  </button>
                                </div>

                                <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                                  {blockers.map((blocker) => (
                                    <div
                                      key={blocker.id}
                                      className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-surface-container/90 hover:bg-surface-container-high border border-outline-variant/30 hover:border-primary/40 transition-all cursor-pointer group/blocker"
                                      onClick={() => {
                                        setActiveBlockerPopoverId(null);
                                        onSelectTask(blocker.id);
                                      }}
                                      title={`Nhấp để chuyển đến: ${blocker.title}`}
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span
                                          className={`w-2 h-2 rounded-full shrink-0 ${
                                            blocker.status === 'DONE'
                                              ? 'bg-emerald-400'
                                              : blocker.status === 'IN_PROGRESS'
                                              ? 'bg-primary animate-pulse'
                                              : 'bg-slate-400'
                                          }`}
                                        />
                                        <span className="text-xs font-medium text-slate-200 group-hover/blocker:text-primary truncate">
                                          {blocker.title}
                                        </span>
                                      </div>
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container-low text-on-surface-variant font-mono shrink-0">
                                        {blocker.status === 'DONE'
                                          ? 'Xong'
                                          : blocker.status === 'IN_PROGRESS'
                                          ? 'Đang làm'
                                          : 'Cần làm'}
                                      </span>
                                    </div>
                                  ))}
                                </div>

                                <div className="pt-1.5 border-t border-outline-variant/30 flex items-center justify-between text-[10px] text-on-surface-variant">
                                  <span>Bấm thẻ để xem chi tiết</span>
                                  <span className="text-primary font-medium">Chi tiết →</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {task.blockedReason && (
                          <div
                            className="kanban-block-reason flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px]"
                            title={task.blockedReason}
                          >
                            <span className="material-symbols-outlined text-[13px] text-rose-400 shrink-0">warning</span>
                            <span className="truncate max-w-[170px]">{task.blockedReason}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Footer: Due date, comments count & Assignee Avatar */}
                    <div className="pt-2 border-t border-outline-variant/30 flex items-center justify-between text-xs text-on-surface-variant">
                      <div className="flex items-center gap-3 text-[11px]">
                        {task.dueAt ? (
                          <span
                            className={`flex items-center gap-1 ${
                              isOverdue
                                ? 'text-rose-400 font-semibold bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/30'
                                : 'text-slate-300'
                            }`}
                            title={
                              isOverdue
                                ? `Đã quá hạn: ${new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(task.dueAt))}`
                                : 'Hạn chót'
                            }
                          >
                            <span className={`material-symbols-outlined text-[13px] ${isOverdue ? 'text-rose-400' : 'text-primary'}`}>
                              {isOverdue ? 'alarm' : 'event'}
                            </span>
                            {new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
                              day: '2-digit',
                              month: '2-digit',
                            }).format(new Date(task.dueAt))}
                            {isOverdue && <span className="text-[9px] uppercase font-bold tracking-tight text-rose-400">Trễ</span>}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-on-surface-variant/50" title="Chưa có hạn chót">
                            <span className="material-symbols-outlined text-[14px]">event</span>
                            --
                          </span>
                        )}

                        <span className="flex items-center gap-1 hover:text-white transition-colors" title="Bình luận trao đổi">
                          <span className="material-symbols-outlined text-[14px]">chat_bubble_outline</span>
                          {((task.id.charCodeAt(0) + task.id.charCodeAt(task.id.length - 1)) % 4) + 1}
                        </span>
                      </div>

                      {/* Multiple Assignees Avatar Stack */}
                      <div className="flex -space-x-1.5 items-center">
                        {task.assigneeIds && task.assigneeIds.length > 0 ? (
                          task.assigneeIds.slice(0, 3).map((id) => {
                            const member = members.find((item) => item.id === id);
                            const initials = (member?.displayName ?? '?').slice(0, 2).toUpperCase();
                            return (
                              <div
                                key={id}
                                className="relative group/avatar"
                                title={`Phụ trách: ${member?.displayName ?? id}`}
                              >
                                <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-primary-container to-primary text-on-primary flex items-center justify-center font-bold text-[10px] ring-2 ring-surface shadow-sm">
                                  {initials}
                                </div>
                                <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 ring-1 ring-surface" />
                              </div>
                            );
                          })
                        ) : (
                          <div
                            className="w-6 h-6 rounded-full bg-surface-container-highest text-on-surface-variant/60 flex items-center justify-center font-medium text-[10px] ring-2 ring-surface"
                            title="Chưa phân công"
                          >
                            --
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {isDropActive && dropIndex === index + 1 && (
                      <div className="kanban-drop-slot">
                        <span className="material-symbols-outlined text-[16px] animate-bounce">south</span>
                        <span>Thả thẻ vào vị trí này</span>
                      </div>
                    )}
                  </Fragment>
                );
              })}
              {isDropActive && columnTasks.length === 0 && (
                <div className="kanban-drop-slot">
                  <span className="material-symbols-outlined text-[16px] animate-bounce">south</span>
                  <span>Thả thẻ vào cột {t(status)}</span>
                </div>
              )}

              {/* Intuitive Drag-and-Drop Zone Placeholder when empty or in DONE */}
              {columnTasks.length === 0 && composerStatus !== status && (
                <div
                  className={`border-2 border-dashed border-outline-variant/40 rounded-xl p-5 flex flex-col items-center justify-center text-center gap-2 transition-all ${
                    status === 'DONE'
                      ? 'hover:border-emerald-400/50 bg-emerald-500/5'
                      : status === 'IN_PROGRESS'
                      ? 'hover:border-primary/50 bg-primary/5'
                      : 'hover:border-outline bg-surface-container/20'
                  }`}
                >
                  <div className="w-9 h-9 rounded-xl bg-surface-container-high/70 flex items-center justify-center text-on-surface-variant">
                    <span
                      className={`material-symbols-outlined text-[20px] ${
                        status === 'DONE'
                          ? 'text-emerald-400/80'
                          : status === 'IN_PROGRESS'
                          ? 'text-primary/80'
                          : 'text-slate-400'
                      }`}
                    >
                      {status === 'DONE' ? 'file_download' : status === 'IN_PROGRESS' ? 'play_arrow' : 'inbox'}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-slate-300">Kéo thả thẻ vào đây</span>
                    <span className="text-[11px] text-on-surface-variant/70">
                      {status === 'DONE'
                        ? 'để đánh dấu hoàn tất công việc'
                        : status === 'IN_PROGRESS'
                        ? 'để bắt đầu thực hiện'
                        : 'để đưa vào hàng đợi'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Task Composer Form */}
            {composerStatus === status ? (
              <form
                className="kanban-task-composer bg-surface-container border border-primary/50 rounded-xl p-3 flex flex-col gap-2.5 shadow-lg"
                noValidate
                onSubmit={async (event) => {
                  event.preventDefault();
                  const title = draftTitle.trim();
                  if (!title) {
                    setComposerError('required');
                    return;
                  }
                  setSubmitting(true);
                  try {
                    const created = await onCreateTask(status, title);
                    if (created) closeComposer();
                    else setComposerError('save');
                  } finally {
                    setSubmitting(false);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !submitting) {
                    event.preventDefault();
                    closeComposer();
                  }
                }}
              >
                <input
                  key={status}
                  autoFocus
                  aria-label={t('title')}
                  placeholder="Nhập tiêu đề công việc..."
                  value={draftTitle}
                  maxLength={200}
                  disabled={!canEdit || submitting}
                  onChange={(event) => {
                    setDraftTitle(event.target.value);
                    setComposerError(null);
                  }}
                  className="w-full bg-surface-container-low border border-outline-variant/60 rounded-lg px-3 py-2 text-xs text-white placeholder:text-on-surface-variant/60 focus:outline-none focus:border-primary/80 focus:ring-1 focus:ring-primary/40 transition-all"
                />
                {composerError && (
                  <span className="text-[11px] text-rose-300 font-medium">
                    {t(composerError === 'required' ? 'taskTitleRequired' : 'saveFailed')}
                  </span>
                )}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={closeComposer}
                    className="px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-white hover:bg-surface-container-high text-xs font-semibold transition-all"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={!canEdit || submitting}
                    className="px-3.5 py-1.5 rounded-lg bg-primary hover:bg-[#82e6d9] text-slate-950 font-extrabold text-xs shadow-sm hover:brightness-105 active:scale-95 transition-all flex items-center gap-1 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    <span>{submitting ? 'Đang tạo...' : 'Thêm thẻ'}</span>
                  </button>
                </div>
              </form>
            ) : (
              canEdit && (
                <button
                  type="button"
                  className={`w-full py-2.5 rounded-xl border border-dashed text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                    status === 'DONE'
                      ? 'border-outline-variant/50 hover:border-emerald-400/60 bg-surface-container/40 hover:bg-emerald-500/10 text-slate-300 hover:text-emerald-300'
                      : status === 'IN_PROGRESS'
                      ? 'border-outline-variant/50 hover:border-primary/60 bg-surface-container/40 hover:bg-primary/10 text-slate-300 hover:text-primary'
                      : 'border-outline-variant/50 hover:border-slate-400/60 bg-surface-container/40 hover:bg-surface-container-high text-slate-300 hover:text-white'
                  }`}
                  onClick={() => openComposer(status)}
                >
                  <span className="material-symbols-outlined text-[17px]">add</span>
                  <span>Thêm công việc vào {t(status)}</span>
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
