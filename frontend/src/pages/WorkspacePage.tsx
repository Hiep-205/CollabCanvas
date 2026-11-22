import {
  addEdge,
  Background,
  BackgroundVariant,
  Connection,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import {
  AlertTriangle,
  Building2,
  Check,
  Edit3,
  Focus,
  ArrowLeft,
  LayoutGrid,
  History,
  Link2,
  LogOut,
  Mail,
  Minus,
  Moon,
  Plus,
  Settings,
  StickyNote,
  Sun,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../app/api';
import type { User, Workspace, WorkspaceInvitation } from '../app/api';
import { createPortal } from 'react-dom';
import { usePreferences } from '../app/Preferences';
import ActivityView from '../features/activity/ActivityView';
import { nodeTypes } from '../features/canvas/nodes';
import { isBottleneckEdge, relationKind, taskBlockers, wouldCreateDependencyCycle } from '../features/canvas/relationships';
import type { CanvasEdge, CanvasNode, StickyNode, TaskCardNode } from '../features/canvas/model';
import { useCanvasSync } from '../features/canvas/useCanvasSync';
import KanbanBoard from '../features/kanban/KanbanBoard';
import { TaskContext } from '../features/tasks/TaskContext';
import type { Task, TaskStatus } from '../features/tasks/model';
import { fromApiTask, listAllMembers, listAllTasks } from '../features/tasks/api';
import type { ServerTask, TaskFilters, WorkspaceMember } from '../features/tasks/api';
import { useWorkspaceTasks } from '../features/tasks/useWorkspaceTasks';
import TrashView from '../features/trash/TrashView';
import { changeNoteTrash, changeTaskTrash } from '../features/trash/api';
import {
  useWorkspaceSocket,
  type CanvasBumpedEvent,
  type CommentCreatedEvent,
  type CursorPosition,
  type MentionNotifyEvent,
  type TaskMutatedEvent,
} from '../features/realtime/useWorkspaceSocket';
import { PresenceBar } from '../features/realtime/PresenceBar';
import { LiveCursorsLayer } from '../features/canvas/LiveCursorsLayer';
import { TaskCommentsSection } from '../features/comments/TaskCommentsSection';
import { MentionNotificationsPopover } from '../features/comments/MentionNotificationsPopover';
import { WorkspaceMembersDialog } from '../features/workspaces/WorkspaceMembersDialog';

type Props = {
  workspace: Workspace;
  user: User;
  workspaces: Workspace[];
  onWorkspaceChange: (id: string, taskId?: string) => void;
  onWorkspacesRefresh?: () => Promise<void>;
  onAccessRevoked: () => void;
  onLogout: () => void;
  onDashboard: () => void;
  onAccount: () => void;
  onInvitations: () => void;
  initialTaskId?: string | null;
};

const taskDraftKey = (userId: string, workspaceId: string, taskId: string) =>
  `collabcanvas.task-draft.${userId}.${workspaceId}.${taskId}`;

function showHeaderMenu(menu: HTMLDivElement | null) {
  const trigger = menu?.previousElementSibling;
  if (!menu || !trigger) return;
  const bounds = trigger.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 24);
  const left = menu.dataset.align === 'left' ? bounds.left : bounds.right - width;
  menu.style.left = `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`;
  menu.style.top = `${bounds.bottom + 8}px`;
  if (!menu.matches(':popover-open')) menu.showPopover();
}

export default function WorkspacePage({
  workspace,
  user,
  workspaces,
  onWorkspaceChange,
  onWorkspacesRefresh,
  onAccessRevoked,
  onLogout,
  onDashboard,
  onAccount,
  onInvitations,
  initialTaskId,
}: Props) {
  const { locale, setLocale, theme, setTheme, showCursors, t } = usePreferences();
  const server = useWorkspaceTasks(workspace.id);

  // Subscription listener for high-frequency cursor updates to avoid re-rendering entire WorkspacePage
  const cursorSubscribersRef = useRef<Set<(cursor: CursorPosition) => void>>(new Set());

  const subscribeCursorUpdated = useCallback((callback: (cursor: CursorPosition) => void) => {
    cursorSubscribersRef.current.add(callback);
    return () => {
      cursorSubscribersRef.current.delete(callback);
    };
  }, []);

  const handleCursorUpdated = useCallback(
    (cursor: CursorPosition) => {
      if (cursor.userId === user.id) return;
      cursorSubscribersRef.current.forEach((cb) => cb(cursor));
    },
    [user.id]
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const [descriptionDraft, setDescriptionDraft] = useState<{ taskId: string; value: string } | null>(null);
  const [blockedReasonDraft, setBlockedReasonDraft] = useState<{ taskId: string; value: string } | null>(null);
  const [checklistDraft, setChecklistDraft] = useState<{ taskId: string; value: string } | null>(null);
  const [taskDraft, setTaskDraft] = useState('');
  const [taskDraftId, setTaskDraftId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const boardTasks = useMemo(
    () =>
      server.tasks.map((task) => ({
        ...fromApiTask(task),
        title: taskDraftId === task.id && taskDraft ? taskDraft : task.title,
        description: descriptionDraft?.taskId === task.id ? descriptionDraft.value : task.description,
        blockedReason: blockedReasonDraft?.taskId === task.id ? blockedReasonDraft.value : task.blockedReason,
      })),
    [server.tasks, taskDraftId, taskDraft, descriptionDraft, blockedReasonDraft]
  );

  const canEdit = workspace.role !== 'viewer';
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TaskFilters['priority'] | ''>('');
  const [dueFilter, setDueFilter] = useState<TaskFilters['due'] | ''>('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersDialogWorkspace, setMembersDialogWorkspace] = useState<Workspace | null>(null);
  const [filteredTasks, setFilteredTasks] = useState<ServerTask[] | null>(null);
  const [filterError, setFilterError] = useState(false);

  // View state: 'kanban' | 'canvas' | 'trash' | 'activity'
  const [activeView, setActiveView] = useState<'kanban' | 'canvas' | 'trash' | 'activity'>('kanban');
  // Kanban sub-view mode: 'kanban' | 'list' | 'calendar'
  const [kanbanViewMode, setKanbanViewMode] = useState<'kanban' | 'list' | 'calendar'>('kanban');

  // Workspace Switcher & Hub Modals
  const [isWorkspaceSwitcherOpen, setIsWorkspaceSwitcherOpen] = useState(false);
  const [wsFilterQuery, setWsFilterQuery] = useState('');
  const [isWorkspaceHubOpen, setIsWorkspaceHubOpen] = useState(false);
  const [workspaceHubTab, setWorkspaceHubTab] = useState<'all' | 'owned' | 'joined' | 'invitations'>('all');
  const [isCreateWorkspaceModalOpen, setIsCreateWorkspaceModalOpen] = useState(false);
  const [createWsName, setCreateWsName] = useState('');
  const [createWsDesc, setCreateWsDesc] = useState('');
  const [isCreatingWs, setIsCreatingWs] = useState(false);
  const [createWsError, setCreateWsError] = useState('');

  // Workspace Edit & Delete in Hub
  const [editingWorkspace, setEditingWorkspace] = useState<{ id: string; name: string; description: string } | null>(null);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<Workspace | null>(null);
  const [workspaceToLeave, setWorkspaceToLeave] = useState<Workspace | null>(null);
  const [hubActionBusy, setHubActionBusy] = useState(false);
  const [hubMessage, setHubMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Invitations
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);

  // User Profile & Account Settings
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  // Password Change

  // Modals for Members, Files, Settings, Notifications, New Task
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus>('TODO');

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load invitations
  const loadInvitations = useCallback(async () => {
    try {
      const res = await api<{ items: WorkspaceInvitation[] }>('/invitations');
      setInvitations(res.items || []);
    } catch {
      setInvitations([]);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void api<{ items: WorkspaceInvitation[] }>('/invitations')
      .then((res) => {
        if (active) setInvitations(res.items || []);
      })
      .catch(() => {
        if (active) setInvitations([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!searchQuery.trim() && !priorityFilter && !dueFilter && !assigneeFilter) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void listAllTasks(workspace.id, {
        query: searchQuery.trim(),
        priority: priorityFilter || undefined,
        due: dueFilter || undefined,
        assigneeId: assigneeFilter || undefined,
      })
        .then((items) => {
          if (active) {
            setFilteredTasks(items);
            setFilterError(false);
          }
        })
        .catch(() => {
          if (active) setFilterError(true);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [workspace.id, searchQuery, priorityFilter, dueFilter, assigneeFilter, server.tasks]);

  useEffect(() => {
    let active = true;
    void listAllMembers(workspace.id)
      .then((items) => {
        if (active) setMembers(items);
      })
      .catch(() => {
        if (active) setMembers([]);
      });
    return () => {
      active = false;
    };
  }, [workspace.id]);

  const hasFilters = Boolean(searchQuery.trim() || priorityFilter || dueFilter || assigneeFilter);
  const filteredIds = useMemo(() => new Set(filteredTasks?.map((task) => task.id) ?? []), [filteredTasks]);

  const visibleTasks = useMemo(() => {
    let list = hasFilters && filteredTasks ? boardTasks.filter((task) => filteredIds.has(task.id)) : boardTasks;
    if (myTasksOnly) {
      list = list.filter((t) => t.assigneeIds && t.assigneeIds.includes(user.id));
    }
    return list;
  }, [hasFilters, filteredTasks, boardTasks, filteredIds, myTasksOnly, user.id]);

  const completedCount = boardTasks.filter((task) => task.status === 'DONE').length;
  const completionPercent = boardTasks.length ? Math.round((completedCount / boardTasks.length) * 100) : 0;
  const draftKey = useCallback((taskId: string) => taskDraftKey(user.id, workspace.id, taskId), [user.id, workspace.id]);

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const canvas = useCanvasSync(workspace.id, user.id, nodes, edges, setNodes, setEdges, canEdit);

  const [trashError, setTrashError] = useState<string | null>(null);
  const [trashBusy, setTrashBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [sidebarNotice, setSidebarNotice] = useState<string | null>(null);
  const [relationNotice, setRelationNotice] = useState<string | null>(null);
  const openedInitialTask = useRef<string | null>(null);
  useEffect(() => {
    if (!initialTaskId || openedInitialTask.current === initialTaskId) return;
    if (server.loading) return;
    openedInitialTask.current = initialTaskId;
    const exists = server.tasks.some((task) => task.id === initialTaskId);
    const timer = window.setTimeout(() => {
      if (exists) {
        setSelectedTaskId(initialTaskId);
        setActiveView('kanban');
        setMobilePanelOpen(true);
      } else {
        setSidebarNotice(t('taskNotFoundLink'));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialTaskId, server.loading, server.tasks, t]);

  // Milestone 4: Zero-reload state synchronization
  const { loading: canvasLoading, state: canvasState, refresh: refreshCanvas } = canvas;
  const reloadServer = server.reload;
  const pendingCanvasReloadRef = useRef(false);
  const taskReloadTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (taskReloadTimerRef.current) {
        window.clearTimeout(taskReloadTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!canvasLoading && canvasState === 'saved' && pendingCanvasReloadRef.current) {
      pendingCanvasReloadRef.current = false;
      void refreshCanvas();
    } else if (canvasState === 'error') {
      pendingCanvasReloadRef.current = false;
    }
  }, [canvasLoading, canvasState, refreshCanvas]);

  const handleTaskMutated = useCallback(
    (event: TaskMutatedEvent) => {
      if (event.workspaceId && event.workspaceId !== workspace.id) return;

      if (event.action === 'trashed' && event.taskId === selectedTaskId) {
        setSelectedTaskId(null);
        setMobilePanelOpen(false);
        setSidebarNotice('Công việc bạn đang xem đã được chuyển vào thùng rác bởi thành viên khác.');
        setDescriptionDraft(null);
        setBlockedReasonDraft(null);
        setChecklistDraft(null);
        setTaskDraftId(null);
        setTaskDraft('');
        window.sessionStorage.removeItem(draftKey(event.taskId));
      }

      if (taskReloadTimerRef.current) {
        window.clearTimeout(taskReloadTimerRef.current);
      }
      taskReloadTimerRef.current = window.setTimeout(() => {
        void reloadServer();
      }, 100);
    },
    [workspace.id, selectedTaskId, draftKey, reloadServer]
  );

  const refreshCanvasWhenReady = useCallback(() => {
    if (canvasLoading || canvasState === 'saving') {
      pendingCanvasReloadRef.current = true;
    } else {
      pendingCanvasReloadRef.current = false;
      void refreshCanvas();
    }
  }, [canvasLoading, canvasState, refreshCanvas]);

  const handleCanvasBumped = useCallback((event: CanvasBumpedEvent) => {
    if (event.workspaceId && event.workspaceId !== workspace.id) return;
    if (event.updatedByUserId === user.id) return;
    refreshCanvasWhenReady();
  }, [workspace.id, user.id, refreshCanvasWhenReady]);

  const catchUpAfterReconnect = useCallback(() => {
    void reloadServer();
    refreshCanvasWhenReady();
  }, [reloadServer, refreshCanvasWhenReady]);

  useEffect(() => {
    window.addEventListener('online', catchUpAfterReconnect);
    return () => window.removeEventListener('online', catchUpAfterReconnect);
  }, [catchUpAfterReconnect]);

  const [lastCommentCreated, setLastCommentCreated] = useState<CommentCreatedEvent | null>(null);
  const [lastMentionNotify, setLastMentionNotify] = useState<MentionNotifyEvent | null>(null);

  const { onlineMembers, sendCursorMove } = useWorkspaceSocket({
    workspaceId: workspace.id,
    onCursorUpdated: handleCursorUpdated,
    onTaskMutated: handleTaskMutated,
    onCanvasBumped: handleCanvasBumped,
    onWorkspaceRejoined: catchUpAfterReconnect,
    onCommentCreated: (event) => setLastCommentCreated(event),
    onMentionNotify: (event) => setLastMentionNotify(event),
    onAccessRevoked,
    onRoleChanged: () => { void onWorkspacesRefresh?.(); },
  });
  const canvasRef = useRef<HTMLDivElement>(null);
  const isCompact = window.matchMedia('(max-width: 700px)').matches;
  const { fitView, screenToFlowPosition, setCenter, zoomIn, zoomOut } = useReactFlow<CanvasNode, CanvasEdge>();

  const handleCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      const flowPos = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      sendCursorMove(Math.round(flowPos.x), Math.round(flowPos.y));
    },
    [canEdit, screenToFlowPosition, sendCursorMove]
  );
  const nodesRef = useRef(nodes);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // Global hotkeys (N: new task, F / Cmd+K: search, Esc: close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        setIsWorkspaceSwitcherOpen(false);
        setIsWorkspaceHubOpen(false);
        setIsCreateWorkspaceModalOpen(false);
        setIsProfileMenuOpen(false);
        setIsNewTaskModalOpen(false);
        setMobilePanelOpen(false);
        setWorkspaceToDelete(null);
        setWorkspaceToLeave(null);
        return;
      }
      if (!isInput) {
        if (e.key.toLowerCase() === 'n' && canEdit) {
          e.preventDefault();
          setIsNewTaskModalOpen(true);
        } else if (e.key.toLowerCase() === 'f') {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canEdit]);

  const selectedNode = nodes.find((node) => node.id === selectedId);
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
  const detailTaskId = activeView === 'canvas' ? (selectedNode?.type === 'task' ? selectedNode.data.taskId : null) : selectedTaskId;
  const selectedTask = boardTasks.find((task) => task.id === detailTaskId);
  const selectedServerTask = server.tasks.find((task) => task.id === detailTaskId);
  const boardDraft = taskDraftId === selectedServerTask?.id ? taskDraft : selectedServerTask?.title ?? '';
  const selectedVersion = selectedServerTask?.version;

  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);
  const isLinkCopied = Boolean(copiedTaskId && selectedTask && copiedTaskId === selectedTask.id);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopyTaskLink = useCallback(() => {
    if (!selectedTask) return;
    const url = `${window.location.origin}${window.location.pathname}#/workspaces/${workspace.id}?task=${selectedTask.id}`;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url);
    } else {
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopiedTaskId(selectedTask.id);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedTaskId(null), 2000);
  }, [selectedTask, workspace.id]);

  const handleOpenTaskFromMention = useCallback(
    (targetWorkspaceId: string, targetTaskId: string) => {
      if (targetWorkspaceId === workspace.id) {
        setSelectedTaskId(targetTaskId);
        setMobilePanelOpen(true);
        const targetNode = nodes.find((n) => n.type === 'task' && n.data.taskId === targetTaskId);
        if (targetNode) {
          setSelectedId(targetNode.id);
          setCenter(targetNode.position.x + 100, targetNode.position.y + 50, { zoom: 1, duration: 400 });
        }
      } else {
        onWorkspaceChange(targetWorkspaceId, targetTaskId);
      }
    },
    [workspace.id, nodes, setCenter, onWorkspaceChange],
  );

  const refreshAfterTrash = async () => {
    await Promise.all([server.reload(), canvas.reload(true)]);
    setSelectedTaskId(null);
    setSelectedId(null);
    setMobilePanelOpen(false);
  };

  const trashSelected = async (type: 'task' | 'note') => {
    if (!canEdit || trashBusy) return;
    if (
      canvas.loading ||
      canvas.state !== 'saved' ||
      canvas.error ||
      server.savingId ||
      taskDraftId ||
      descriptionDraft ||
      blockedReasonDraft
    ) {
      setTrashError(t('trashBusy'));
      return;
    }
    setTrashBusy(true);
    setTrashError(null);
    try {
      if (type === 'task' && selectedServerTask) {
        await changeTaskTrash(workspace.id, selectedServerTask.id, selectedServerTask.version, true);
      } else if (type === 'note' && selectedNode?.type === 'sticky' && canvas.version) {
        await changeNoteTrash(workspace.id, selectedNode.id, canvas.version, true);
      } else {
        throw new Error('Selection unavailable');
      }
      await refreshAfterTrash();
    } catch {
      setTrashError(t('trashFailed'));
    } finally {
      setTrashBusy(false);
    }
  };

  const changeServerTask = server.change;
  useEffect(() => {
    if (
      !selectedServerTask ||
      taskDraftId !== selectedServerTask.id ||
      !taskDraft.trim() ||
      taskDraft.trim() === selectedServerTask.title ||
      server.error ||
      server.savingId
    )
      return;
    const timer = window.setTimeout(() => {
      void changeServerTask(selectedServerTask.id, { title: taskDraft.trim() }).then((saved) => {
        if (saved) {
          window.sessionStorage.removeItem(draftKey(selectedServerTask.id));
          setTaskDraftId(null);
        }
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [selectedServerTask, selectedVersion, taskDraftId, taskDraft, server.error, server.savingId, changeServerTask, draftKey]);

  const blockedBy = useMemo(() => taskBlockers(boardTasks, nodes, edges), [boardTasks, nodes, edges]);
  const displayEdges = useMemo(
    () =>
      edges
        .filter(
          (edge) =>
            nodes.some((node) => node.id === edge.source && !node.hidden) &&
            nodes.some((node) => node.id === edge.target && !node.hidden)
        )
        .map((edge) => {
          const dependency = relationKind(edge, nodes) === 'dependency';
          const bottleneck = dependency && isBottleneckEdge(edge, nodes, boardTasks, now);
          return {
            ...edge,
            type: 'smoothstep',
            className: dependency ? (bottleneck ? 'relation-dependency relation-bottleneck' : 'relation-dependency') : 'relation-association',
            style: {
              stroke: bottleneck ? '#f43f5e' : dependency ? 'var(--accent)' : 'var(--subtle)',
              strokeWidth: bottleneck ? 2.8 : dependency ? 2.2 : 1.6,
              strokeDasharray: dependency ? (bottleneck ? '6 3' : undefined) : '5 5',
            },
            markerEnd: dependency
              ? {
                  type: MarkerType.ArrowClosed,
                  color: bottleneck ? '#f43f5e' : 'var(--accent)',
                  width: 24,
                  height: 24,
                }
              : undefined,
          };
        }),
    [edges, nodes, boardTasks, now]
  );

  const placedTaskIds = useMemo(
    () => new Set(nodes.filter((node): node is TaskCardNode => node.type === 'task' && !node.hidden).map((node) => node.data.taskId)),
    [nodes]
  );
  const unplacedTasks = boardTasks.filter((task) => !placedTaskIds.has(task.id));

  useEffect(() => {
    if (isCompact && activeView === 'kanban') return;
    const timer = window.setTimeout(() => {
      if (isCompact) {
        const first = nodesRef.current[0];
        if (first) void setCenter(first.position.x + 122, first.position.y + 80, { zoom: 0.85, duration: 200 });
      } else {
        void fitView({ padding: 0.18, maxZoom: 1, duration: 200 });
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [activeView, fitView, isCompact, setCenter]);

  const nextPosition = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const center = screenToFlowPosition({ x, y });
    const offsets = [
      [0, 0],
      [300, 0],
      [0, 210],
      [-300, 0],
      [300, 210],
      [-300, 210],
      [0, -210],
      [300, -210],
      [-300, -210],
    ];
    for (const [dx, dy] of offsets) {
      const candidate = { x: center.x + dx, y: center.y + dy };
      if (
        nodes.every(
          (node) =>
            node.hidden ||
            Math.abs(node.position.x - candidate.x) >= 265 ||
            Math.abs(node.position.y - candidate.y) >= 185
        )
      ) {
        return candidate;
      }
    }
    return { x: center.x + nodes.length * 35, y: center.y + nodes.length * 35 };
  }, [nodes, screenToFlowPosition]);

  const addNote = useCallback(() => {
    if (!canEdit || canvas.loading || canvas.error) return;
    const id = crypto.randomUUID();
    const position = nextPosition();
    setNodes((current) => [...current, { id, type: 'sticky', position, data: { text: t('newNote'), color: 'yellow' } }]);
    void setCenter(position.x + 122, position.y + 80, { zoom: isCompact ? 0.85 : 1, duration: 300 });
    setSelectedId(id);
    setActiveView('canvas');
    setMobilePanelOpen(true);
  }, [canEdit, canvas.loading, canvas.error, isCompact, nextPosition, setCenter, setNodes, t]);

  const addTaskNode = useCallback(
    (taskId: string) => {
      if (!canEdit || canvas.loading || canvas.error) return;
      const hiddenNode = nodes.find((node) => node.type === 'task' && node.data.taskId === taskId && node.hidden);
      const id = hiddenNode?.id ?? crypto.randomUUID();
      const position = nextPosition();
      setNodes((current) =>
        hiddenNode
          ? current.map((node) => (node.id === hiddenNode.id ? { ...node, hidden: false, position } : node))
          : [...current, { id, type: 'task', position, data: { taskId } }]
      );
      void setCenter(position.x + 123, position.y + 72, { zoom: isCompact ? 0.85 : 1, duration: 300 });
      setSelectedId(id);
      setActiveView('canvas');
      setMobilePanelOpen(true);
    },
    [canEdit, canvas.loading, canvas.error, isCompact, nextPosition, nodes, setCenter, setNodes]
  );

  const addTask = useCallback(async () => {
    if (!canEdit) return;
    const created = await server.create('TODO', t('newTask'));
    if (created) addTaskNode(created.id);
  }, [canEdit, server, addTaskNode, t]);

  const convertNote = async () => {
    if (!canEdit || selectedNode?.type !== 'sticky' || selectedNode.data.taskId || canvas.loading || canvas.error || canvas.state !== 'saved' || server.savingId) return;
    const nodeId = crypto.randomUUID();
    const title =
      selectedNode.data.text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
        ?.slice(0, 100) || t('newTask');
    const created = await server.create('TODO', title);
    if (!created) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id && node.type === 'sticky' ? { ...node, data: { ...node.data, taskId: created.id } } : node
      )
    );
    const offsets = [
      [300, 0],
      [300, 210],
      [0, 210],
      [-300, 0],
      [0, -210],
    ];
    const position =
      offsets
        .map(([dx, dy]) => ({ x: selectedNode.position.x + dx, y: selectedNode.position.y + dy }))
        .find((candidate) =>
          nodes.every(
            (node) =>
              node.hidden ||
              Math.abs(node.position.x - candidate.x) >= 265 ||
              Math.abs(node.position.y - candidate.y) >= 185
          )
        ) ?? nextPosition();
    setNodes((current) => [...current, { id: nodeId, type: 'task', position, data: { taskId: created.id } }]);
    setEdges((current) =>
      addEdge({ id: crypto.randomUUID(), source: selectedNode.id, target: nodeId, type: 'smoothstep', data: { kind: 'association' } }, current)
    );
    setSelectedId(nodeId);
    void setCenter(position.x + 123, position.y + 72, { zoom: isCompact ? 0.85 : 1, duration: 300 });
  };

  const [pendingDoneTask, setPendingDoneTask] = useState<{ id: string; blockers: Task[] } | null>(null);

  const moveTask = useCallback(
    (id: string, status: TaskStatus) => {
      if (!canEdit) return;
      if (status === 'DONE') {
        const blockers = blockedBy.get(id);
        if (blockers && blockers.length > 0) {
          setPendingDoneTask({ id, blockers });
          return;
        }
        setBlockedReasonDraft(null);
      }
      void server.move(id, status);
    },
    [canEdit, blockedBy, server, setPendingDoneTask]
  );

  const removeSelected = useCallback(() => {
    if (!canEdit || !selectedId) return;
    const node = nodes.find((item) => item.id === selectedId);
    if (node?.type === 'task') {
      setNodes((current) => current.map((item) => (item.id === selectedId ? { ...item, hidden: true } : item)));
      setSelectedId(null);
      setMobilePanelOpen(false);
    }
  }, [canEdit, nodes, selectedId, setNodes]);

  const updateNote = (patch: Partial<StickyNode['data']>) => {
    if (!canEdit || !selectedId) return;
    setNodes((current) =>
      current.map((node) => (node.id === selectedId && node.type === 'sticky' ? { ...node, data: { ...node.data, ...patch } } : node))
    );
  };

  const updateTask = (patch: Partial<Omit<Task, 'id'>>) => {
    if (!selectedTask) return;
    if (canEdit && patch.status) {
      if (patch.status === 'DONE') {
        const blockers = blockedBy.get(selectedTask.id);
        if (blockers && blockers.length > 0) {
          setPendingDoneTask({ id: selectedTask.id, blockers });
          return;
        }
        setBlockedReasonDraft(null);
      }
      void server.move(selectedTask.id, patch.status);
    }
  };

  const retrySelectedTaskSave = async () => {
    if (!selectedTask || !canEdit || server.savingId) return;
    const taskId = selectedTask.id;
    server.clearError();
    if (taskDraftId === taskId && taskDraft.trim() && taskDraft.trim() !== selectedServerTask?.title) {
      if (!(await server.change(taskId, { title: taskDraft.trim() }))) return;
      window.sessionStorage.removeItem(draftKey(taskId));
      setTaskDraftId(null);
    }
    if (descriptionDraft?.taskId === taskId) {
      if (!(await server.change(taskId, { description: descriptionDraft.value.trim() || null }))) return;
      setDescriptionDraft((current) => current?.taskId === taskId && current.value === descriptionDraft.value ? null : current);
    }
    if (blockedReasonDraft?.taskId === taskId) {
      if (!(await server.change(taskId, { blockedReason: blockedReasonDraft.value.trim() || null }))) return;
      setBlockedReasonDraft((current) => current?.taskId === taskId && current.value === blockedReasonDraft.value ? null : current);
    }
  };

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!canEdit || canvas.error || canvas.loading) return;
      const { source, target } = connection;
      if (!source || !target || source === target) {
        setRelationNotice(t('invalidRelation'));
        return;
      }
      const kind = relationKind({ source, target }, nodes);
      if (
        edges.some(
          (edge) =>
            (edge.source === source && edge.target === target) ||
            (kind === 'association' && edge.source === target && edge.target === source)
        )
      ) {
        setRelationNotice(t('duplicateRelation'));
        return;
      }
      if (kind === 'dependency' && wouldCreateDependencyCycle(source, target, nodes, edges)) {
        setRelationNotice(t('cycleRelation'));
        return;
      }
      setEdges((current) => addEdge({ ...connection, id: crypto.randomUUID(), type: 'smoothstep', data: { kind } }, current));
      setRelationNotice(null);
    },
    [canEdit, canvas.error, canvas.loading, edges, nodes, setEdges, t]
  );

  const nodeLabel = (nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (node?.type === 'task') return boardTasks.find((task) => task.id === node.data.taskId)?.title ?? t('missingTask');
    return node?.type === 'sticky' ? node.data.text.split(/\r?\n/)[0] : '';
  };

  // ================= WORKSPACE MANAGEMENT ACTIONS =================
  const ownedWorkspaces = useMemo(() => workspaces.filter((w) => w.role === 'owner'), [workspaces]);
  const joinedWorkspaces = useMemo(() => workspaces.filter((w) => w.role !== 'owner'), [workspaces]);

  const filteredHubWorkspaces = useMemo(() => {
    let list = workspaces;
    if (workspaceHubTab === 'owned') list = ownedWorkspaces;
    else if (workspaceHubTab === 'joined') list = joinedWorkspaces;

    if (wsFilterQuery.trim()) {
      const q = wsFilterQuery.toLowerCase();
      list = list.filter((w) => w.name.toLowerCase().includes(q) || (w.description && w.description.toLowerCase().includes(q)));
    }
    return list;
  }, [workspaces, workspaceHubTab, ownedWorkspaces, joinedWorkspaces, wsFilterQuery]);

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = createWsName.trim();
    if (!name) return;
    setIsCreatingWs(true);
    setCreateWsError('');
    try {
      const created = await api<Workspace>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name, description: createWsDesc.trim() || undefined }),
      });
      setCreateWsName('');
      setCreateWsDesc('');
      setIsCreateWorkspaceModalOpen(false);
      if (onWorkspacesRefresh) await onWorkspacesRefresh();
      onWorkspaceChange(created.id);
      setHubMessage({ type: 'success', text: `Đã tạo không gian "${created.name}" thành công!` });
    } catch {
      setCreateWsError('Không thể tạo không gian làm việc. Vui lòng thử lại.');
    } finally {
      setIsCreatingWs(false);
    }
  };

  const handleSaveWorkspaceEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorkspace || !editingWorkspace.name.trim()) return;
    setHubActionBusy(true);
    try {
      await api(`/workspaces/${editingWorkspace.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editingWorkspace.name.trim(),
          description: editingWorkspace.description.trim() || undefined,
        }),
      });
      setEditingWorkspace(null);
      if (onWorkspacesRefresh) await onWorkspacesRefresh();
      setHubMessage({ type: 'success', text: 'Cập nhật thông tin không gian thành công!' });
    } catch {
      setHubMessage({ type: 'error', text: 'Lỗi khi cập nhật không gian làm việc.' });
    } finally {
      setHubActionBusy(false);
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!workspaceToDelete) return;
    setHubActionBusy(true);
    try {
      await api(`/workspaces/${workspaceToDelete.id}`, { method: 'DELETE' });
      setWorkspaceToDelete(null);
      if (onWorkspacesRefresh) await onWorkspacesRefresh();
      setHubMessage({ type: 'success', text: 'Đã xóa không gian làm việc thành công.' });
    } catch {
      setHubMessage({ type: 'error', text: 'Lỗi khi xóa không gian làm việc.' });
    } finally {
      setHubActionBusy(false);
    }
  };

  const handleLeaveWorkspace = async () => {
    if (!workspaceToLeave) return;
    setHubActionBusy(true);
    try {
      await api(`/workspaces/${workspaceToLeave.id}/leave`, { method: 'DELETE' });
      setWorkspaceToLeave(null);
      if (onWorkspacesRefresh) await onWorkspacesRefresh();
      setHubMessage({ type: 'success', text: 'Đã rời khỏi không gian làm việc.' });
    } catch {
      setHubMessage({ type: 'error', text: 'Không thể rời không gian làm việc.' });
    } finally {
      setHubActionBusy(false);
    }
  };

  const handleAcceptInvitation = async (invitationId: string) => {
    try {
      await api(`/invitations/${invitationId}/accept`, { method: 'POST' });
      await loadInvitations();
      if (onWorkspacesRefresh) await onWorkspacesRefresh();
      setHubMessage({ type: 'success', text: 'Đã chấp nhận lời mời tham gia!' });
    } catch {
      setHubMessage({ type: 'error', text: 'Không thể chấp nhận lời mời.' });
    }
  };

  const handleDeclineInvitation = async (invitationId: string) => {
    try {
      await api(`/invitations/${invitationId}/decline`, { method: 'POST' });
      await loadInvitations();
      setHubMessage({ type: 'success', text: 'Đã từ chối lời mời.' });
    } catch {
      setHubMessage({ type: 'error', text: 'Lỗi xử lý lời mời.' });
    }
  };



  return (
    <TaskContext.Provider value={{ tasks: boardTasks, blockedBy, now }}>
      <div className="workspace-shell bg-surface font-sans text-on-surface antialiased min-h-screen flex overflow-x-hidden selection:bg-primary/30 selection:text-primary">
        {mobileNavOpen && <button type="button" aria-label="Đóng điều hướng" className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setMobileNavOpen(false)} />}
        <aside className={`workspace-sidebar fixed left-0 top-0 z-50 flex h-[100dvh] w-[232px] flex-col border-r border-outline-variant/40 bg-surface-container-low px-5 py-7 transition-transform md:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <button type="button" onClick={onDashboard} className="mb-8 flex items-center gap-3 text-left" aria-label={t('navBackOverview')}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary"><LayoutGrid size={22} /></span>
            <strong className="text-lg font-extrabold">CollabCanvas</strong>
          </button>
          <button type="button" onClick={onDashboard} className="mb-6 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container hover:text-primary" aria-label={t('dashboardTitle')}>
            <ArrowLeft size={16} />{t('navBackOverview')}
          </button>
          <div className="mb-5 border-t border-outline-variant/40 px-3 pt-5">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{t('navCurrentWorkspace')}</p>
            <h2 className="truncate text-sm font-bold text-on-surface" title={workspace.name}>{workspace.name}</h2>
            <span className="mt-2 inline-flex rounded-md bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">{t(workspace.role)}</span>
          </div>
          <nav className="primary-nav flex flex-col gap-1" aria-label={t('navWorkspaceNavigation')} onClick={() => setMobileNavOpen(false)}>
            {([
              { id: 'kanban', label: t('tasksTitle'), icon: LayoutGrid },
              { id: 'canvas', label: t('canvas'), icon: StickyNote },
              { id: 'activity', label: t('activity'), icon: History },
              { id: 'trash', label: t('trash'), icon: Trash2 },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" aria-label={label} aria-current={activeView === id ? 'page' : undefined}
                onClick={() => { setActiveView(id); setMobilePanelOpen(false); }}
                className={`workspace-nav-item flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition-colors ${activeView === id ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'}`}>
                <Icon size={18} className="shrink-0" /><span>{label}</span>
              </button>
            ))}
          </nav>
          <button type="button" onClick={onAccount} className="mt-auto flex items-center gap-3 rounded-xl border-t border-outline-variant/40 pt-5 text-left" aria-label={t('navAccount')}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{(user.displayName || user.email).slice(0,2).toUpperCase()}</span>
            <span className="min-w-0"><strong className="block truncate text-xs">{user.displayName || user.email}</strong><span className="mt-1 block truncate text-[11px] text-on-surface-variant">{t('navAccount')}</span></span>
          </button>
        </aside>

        {/* ================= MAIN CONTENT WRAPPER ================= */}
        <div className="workspace-content pl-0 flex-1 flex flex-col min-w-0">
          {/* Top Global App Bar */}
          <header className="sticky top-0 z-40 h-16 bg-surface/90 backdrop-blur-xl border-b border-outline-variant/40 px-3 md:px-8 flex items-center gap-3 justify-between min-w-0 overflow-x-auto">
            <button type="button" aria-label="Mở điều hướng" className="md:hidden shrink-0 rounded-lg p-2 text-on-surface border border-outline-variant/40" onClick={() => setMobileNavOpen(true)}>
              <span className="material-symbols-outlined">menu</span>
            </button>
            {/* Left: Interactive Workspace Switcher Popover & Canvas/Kanban Switcher */}
              <div className="workspace-header-context flex items-center gap-4">
              <div className="relative min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsWorkspaceSwitcherOpen((prev) => !prev);
                    setIsProfileMenuOpen(false);
                  }}
                  className="workspace-picker flex items-center gap-2.5 bg-surface-container px-3.5 py-1.5 rounded-xl border border-outline-variant/50 hover:border-primary/50 text-white text-xs font-semibold hover:bg-surface-container-high transition-all shadow-sm"
                  title="Bấm để đổi hoặc quản lý không gian làm việc"
                >
                  <span className="material-symbols-outlined text-primary text-[18px]">verified_user</span>
                  <span className="workspace-picker-name max-w-[150px] truncate" title={workspace.name}>{workspace.name}</span>

                  <span className="material-symbols-outlined text-on-surface-variant text-[16px]">
                    {isWorkspaceSwitcherOpen ? 'expand_less' : 'expand_more'}
                  </span>
                </button>

                {/* Workspace Switcher Popover */}
                {isWorkspaceSwitcherOpen && (
                  <div
                    popover="auto"
                    ref={showHeaderMenu}
                    data-align="left"
                    className="workspace-header-menu p-2.5 rounded-2xl bg-surface-container-high/95 backdrop-blur-xl border border-outline-variant/60 shadow-2xl flex-col gap-2 animate-in fade-in zoom-in-95 text-xs"
                    onToggle={(event) => {
                      if (event.newState === 'closed') setIsWorkspaceSwitcherOpen(false);
                    }}
                  >
                    <div className="flex items-center justify-between pb-1.5 border-b border-outline-variant/30 text-[11px] font-bold text-on-surface-variant">
                      <span>CHỌN KHÔNG GIAN LÀM VIỆC</span>
                      <span className="font-mono text-primary">{workspaces.length} tổng cộng</span>
                    </div>

                    {/* Quick filter inside switcher */}
                    <input
                      placeholder="Lọc tên không gian..."
                      value={wsFilterQuery}
                      onChange={(e) => setWsFilterQuery(e.target.value)}
                      className="w-full bg-surface-container border border-outline-variant/40 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary"
                    />

                    <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
                      {/* Owned Section */}
                      {ownedWorkspaces.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-primary tracking-wider uppercase px-1">
                            👑 Không gian bạn làm chủ ({ownedWorkspaces.length})
                          </span>
                          {ownedWorkspaces
                            .filter((w) => !wsFilterQuery || w.name.toLowerCase().includes(wsFilterQuery.toLowerCase()))
                            .map((w) => (
                              <button
                                key={w.id}
                                type="button"
                                onClick={() => {
                                  onWorkspaceChange(w.id);
                                  setIsWorkspaceSwitcherOpen(false);
                                }}
                                className={`flex items-center justify-between p-2 rounded-xl text-left transition-all ${
                                  w.id === workspace.id
                                    ? 'bg-primary/20 text-white font-bold border border-primary/40'
                                    : 'hover:bg-surface-container text-slate-300 hover:text-white'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-6 h-6 rounded-md bg-surface-container-highest flex items-center justify-center font-bold text-[10px] text-primary shrink-0">
                                    {w.name.slice(0, 1).toUpperCase()}
                                  </div>
                                  <span className="truncate">{w.name}</span>
                                </div>
                                {w.id === workspace.id && <Check size={14} className="text-primary shrink-0" />}
                              </button>
                            ))}
                        </div>
                      )}

                      {/* Joined Section */}
                      {joinedWorkspaces.length > 0 && (
                        <div className="flex flex-col gap-1 pt-1 border-t border-outline-variant/20">
                          <span className="text-[10px] font-bold text-secondary tracking-wider uppercase px-1">
                            🤝 Không gian tham gia ({joinedWorkspaces.length})
                          </span>
                          {joinedWorkspaces
                            .filter((w) => !wsFilterQuery || w.name.toLowerCase().includes(wsFilterQuery.toLowerCase()))
                            .map((w) => (
                              <button
                                key={w.id}
                                type="button"
                                onClick={() => {
                                  onWorkspaceChange(w.id);
                                  setIsWorkspaceSwitcherOpen(false);
                                }}
                                className={`flex items-center justify-between p-2 rounded-xl text-left transition-all ${
                                  w.id === workspace.id
                                    ? 'bg-secondary/20 text-white font-bold border border-secondary/40'
                                    : 'hover:bg-surface-container text-slate-300 hover:text-white'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-6 h-6 rounded-md bg-surface-container-highest flex items-center justify-center font-bold text-[10px] text-secondary shrink-0">
                                    {w.name.slice(0, 1).toUpperCase()}
                                  </div>
                                  <span className="truncate">{w.name}</span>
                                </div>
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface-container border border-outline-variant/40 text-on-surface-variant font-mono">
                                  {w.role}
                                </span>
                              </button>
                            ))}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-outline-variant/30 flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setIsWorkspaceSwitcherOpen(false);
                          setIsCreateWorkspaceModalOpen(true);
                        }}
                        className="w-full py-1.5 px-2.5 rounded-lg bg-surface-container hover:bg-surface-container-highest text-primary font-bold text-left flex items-center gap-2 transition-colors"
                      >
                        <Plus size={15} />
                        <span>Tạo không gian làm việc mới</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsWorkspaceSwitcherOpen(false);
                          setIsWorkspaceHubOpen(true);
                        }}
                        className="w-full py-1.5 px-2.5 rounded-lg text-on-surface-variant hover:text-white hover:bg-surface-container text-left flex items-center gap-2 transition-colors"
                      >
                        <Settings size={14} />
                        <span>Quản lý tất cả không gian làm việc</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <span className="hidden items-center gap-2 text-xs text-on-surface-variant lg:flex" aria-hidden="true">
                <span>/</span><span>{t(activeView === 'kanban' ? 'tasksTitle' : activeView === 'canvas' ? 'canvas' : activeView === 'activity' ? 'activity' : 'trash')}</span>
              </span>
            </div>

            {/* Right: Sync Status, Theme, Language & User Profile Avatar Menu */}
            <div className="workspace-header-actions flex items-center gap-3">
              {(activeView === 'kanban' || activeView === 'canvas') && <div className="workspace-sync flex items-center gap-2 bg-surface-container px-3 py-1.5 rounded-xl border border-outline-variant/40 text-xs text-on-surface-variant">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <span className="font-medium text-slate-300" role="status">
                  {activeView === 'kanban'
                    ? server.loading ? t('loading') : server.savingId ? t('saving') : server.error ? t(server.error === 'load' ? 'loadFailed' : 'saveFailed') : t('serverSaved')
                    : canvas.loading ? t('loading') : canvas.state === 'saving' ? t('saving') : canvas.error ? t(canvas.error === 'load' ? 'loadFailed' : 'saveFailed') : t('serverSaved')}
                </span>
              </div>}

              {/* Language Switch */}
              <div className="flex items-center bg-surface-container p-0.5 rounded-xl border border-outline-variant/50 text-xs font-bold">
                <button
                  type="button"
                  className={`px-2 py-1 rounded-lg transition-all ${locale === 'vi' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-white'}`}
                  onClick={() => setLocale('vi')}
                >
                  VI
                </button>
                <button
                  type="button"
                  className={`px-2 py-1 rounded-lg transition-all ${locale === 'en' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-white'}`}
                  onClick={() => setLocale('en')}
                >
                  EN
                </button>
              </div>

              {/* Theme Toggle */}
              <button
                type="button"
                className="w-8 h-8 rounded-xl bg-surface-container border border-outline-variant/50 flex items-center justify-center text-on-surface-variant hover:text-white hover:border-primary/40 transition-all"
                title={theme === 'light' ? 'Bật Dark Mode' : 'Bật Light Mode'}
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              >
                {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
              </button>

              <button type="button" onClick={onInvitations} aria-label={t('dashboardInvitations')} title={t('dashboardInvitations')} className="workspace-invitations relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-outline-variant/50 bg-surface-container text-on-surface-variant hover:text-primary">
                <Mail size={16} />
                {invitations.length > 0 && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-primary" />}
              </button>

              {/* Mention Notifications Popover */}
              <MentionNotificationsPopover
                onOpenTask={handleOpenTaskFromMention}
                lastMentionNotifyEvent={lastMentionNotify}
              />

              {/* Realtime Online Members PresenceBar */}
              <PresenceBar members={onlineMembers} currentUserId={user?.id} />

              {/* USER PROFILE AVATAR WITH INTERACTIVE DROPDOWN */}
              <div className="relative pl-2 border-l border-outline-variant/40">
                <button
                  type="button"
                  onClick={() => {
                    setIsProfileMenuOpen((prev) => !prev);
                    setIsWorkspaceSwitcherOpen(false);
                  }}
                  className="relative cursor-pointer group flex items-center justify-center rounded-full"
                  title={`${user.displayName || user.email} (Bấm để xem hồ sơ & cài đặt)`}
                  aria-label="Tài khoản"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary-container to-primary flex items-center justify-center text-on-primary font-bold text-xs ring-2 ring-surface shadow-md">
                    {(user.displayName || user.email).slice(0, 2).toUpperCase()}
                  </div>
                </button>

                {/* Profile Popover Menu */}
                {isProfileMenuOpen && (
                  <div
                    popover="auto"
                    ref={showHeaderMenu}
                    data-align="right"
                    className="workspace-header-menu p-2.5 rounded-2xl bg-surface-container-high/95 backdrop-blur-xl border border-outline-variant/60 shadow-2xl flex-col gap-1.5 animate-in fade-in zoom-in-95 text-xs"
                    onToggle={(event) => {
                      if (event.newState === 'closed') setIsProfileMenuOpen(false);
                    }}
                  >
                    {/* Header info */}
                    <div className="flex items-center gap-3 p-2 bg-surface-container/80 rounded-xl border border-outline-variant/30">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary to-primary-container flex items-center justify-center text-on-primary font-extrabold text-sm ring-1 ring-white/20 shrink-0">
                        {(user.displayName || user.email).slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-bold text-white truncate text-xs">{user.displayName || 'Thành viên'}</span>
                        <span className="text-[11px] text-on-surface-variant truncate">{user.email}</span>
                        <span className="text-[10px] text-primary flex items-center gap-1 font-semibold mt-0.5">
                          <UserIcon size={12} /> {t('navPersonalAccount')}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 pt-1">
                      <button type="button" onClick={() => { setIsProfileMenuOpen(false); onAccount(); }} className="flex items-center gap-2.5 rounded-xl p-2 text-on-surface hover:bg-surface-container">
                        <UserIcon size={16} className="text-primary" /><span>{t('navAccount')}</span>
                      </button>
                      <div className="h-[1px] bg-outline-variant/30 my-1" />

                      <button
                        type="button"
                        onClick={() => {
                          setIsProfileMenuOpen(false);
                          onLogout();
                        }}
                        className="flex items-center gap-2.5 p-2 rounded-xl text-rose-300 hover:text-rose-200 hover:bg-rose-500/15 font-semibold transition-colors"
                      >
                        <LogOut size={16} />
                        <span>Đăng xuất tài khoản</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Notices */}
          {trashError && (
            <div className="mx-8 mt-3 p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 flex items-center justify-between text-xs">
              <span>{trashError}</span>
              <button type="button" onClick={() => setTrashError(null)}>
                <X size={15} />
              </button>
            </div>
          )}
          {filterError && (
            <div className="mx-8 mt-3 p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 flex items-center justify-between text-xs">
              <span>Lỗi áp dụng bộ lọc công việc</span>
              <button type="button" onClick={() => setFilterError(false)}>
                <X size={15} />
              </button>
            </div>
          )}
          {hubMessage && (
            <div
              className={`mx-8 mt-3 p-3 rounded-xl border flex items-center justify-between text-xs ${
                hubMessage.type === 'success'
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
              }`}
            >
              <span>{hubMessage.text}</span>
              <button type="button" onClick={() => setHubMessage(null)}>
                <X size={15} />
              </button>
            </div>
          )}
          {sidebarNotice && (
            <div className="mx-8 mt-3 p-3 rounded-xl bg-surface-container-high border border-outline-variant/50 flex items-center justify-between text-xs text-on-surface">
              <span>{sidebarNotice}</span>
              <button type="button" onClick={() => setSidebarNotice(null)}>
                <X size={15} />
              </button>
            </div>
          )}
          {relationNotice && (
            <div className="mx-8 mt-3 p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 flex items-center justify-between text-xs">
              <span>{relationNotice}</span>
              <button type="button" onClick={() => setRelationNotice(null)}>
                <X size={15} />
              </button>
            </div>
          )}

          {/* Main Body */}
          <main className="main-view-container p-4 md:p-8 flex flex-col gap-6 max-w-[1600px] w-full min-w-0 mx-auto flex-1">
            {activeView === 'trash' && (
              <TrashView workspaceId={workspace.id} canEdit={canEdit} onRestored={refreshAfterTrash} />
            )}

            {activeView === 'activity' && (
              <ActivityView key={workspace.id} workspaceId={workspace.id} tasks={boardTasks} />
            )}

            {activeView === 'canvas' && (
              <div className="canvas-work-area w-full rounded-2xl overflow-hidden border border-outline-variant/40 relative shadow-2xl bg-surface-container-low" ref={canvasRef}>
                {canvas.error && createPortal(
                  <div role="alert" className={`fixed left-4 right-4 z-[60] flex items-center justify-between gap-3 rounded-xl border border-rose-500/50 bg-surface-container-high p-3 text-xs text-rose-200 shadow-lg md:left-auto md:w-[350px] ${mobilePanelOpen ? 'bottom-4 md:bottom-auto md:top-20 md:right-[376px]' : 'top-20'}`}>
                    <span>{canvas.error === 'conflict' ? t('canvasConflict') : canvas.error === 'load' ? t('loadFailed') : t('saveFailed')}</span>
                    <button type="button" className="shrink-0 font-semibold underline" onClick={() => canvas.error === 'conflict' ? void canvas.reload(true) : canvas.error === 'load' ? void canvas.reload() : canvas.retry()}>
                      {canvas.error === 'conflict' ? t('reloadCanvas') : t('retry')}
                    </button>
                  </div>,
                  document.body
                )}
                <div className="canvas-relation-key" aria-label={t('relation')}>
                  <span><i className="relation-line association-line" />{t('related')}</span>
                  <span><i className="relation-line dependency-line" />{t('dependency')}</span>
                  <span><i className="relation-line bottleneck-line" />{t('bottleneckPath')}</span>
                </div>
                <ReactFlow<CanvasNode, CanvasEdge>
                  nodes={nodes}
                  edges={displayEdges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  nodesDraggable={canEdit && !canvas.loading && !canvas.error}
                  nodesConnectable={canEdit && !canvas.loading && !canvas.error}
                  onNodeClick={(_, node) => {
                    setSelectedId(node.id);
                    setSelectedEdgeId(null);
                    if (node.type === 'task') {
                      const draft = window.sessionStorage.getItem(draftKey(node.data.taskId));
                      setTaskDraftId(draft === null ? null : node.data.taskId);
                      setTaskDraft(draft ?? '');
                    }
                    setMobilePanelOpen(true);
                  }}
                  onEdgeClick={(_, edge) => {
                    setSelectedEdgeId(edge.id);
                    setSelectedId(null);
                    setMobilePanelOpen(true);
                  }}
                  onPaneClick={() => {
                    setSelectedId(null);
                    setSelectedEdgeId(null);
                    setMobilePanelOpen(false);
                  }}
                  fitView
                  fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
                  minZoom={0.2}
                  maxZoom={2.0}
                  onPointerMove={handleCanvasPointerMove}
                  connectionLineStyle={{ stroke: '#6bd8cb', strokeWidth: 2 }}
                  deleteKeyCode={null}
                >
                  <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="var(--canvas-dot)" />
                  <MiniMap pannable zoomable nodeColor={(node) => (node.type === 'sticky' ? '#e4ad63' : '#4caaa0')} />
                  {showCursors && (
                    <LiveCursorsLayer
                      currentUserId={user.id}
                      onlineMembers={onlineMembers}
                      workspaceId={workspace.id}
                      subscribeCursorUpdated={subscribeCursorUpdated}
                    />
                  )}
                </ReactFlow>

                <div className="canvas-zoom-controls">
                  <button type="button" className="icon-button" aria-label={t('navZoomOut')} title={t('navZoomOut')} onClick={() => zoomOut({ duration: 200 })}>
                    <Minus size={17} />
                  </button>
                  <button type="button" className="icon-button" aria-label={t('navZoomIn')} title={t('navZoomIn')} onClick={() => zoomIn({ duration: 200 })}>
                    <Plus size={17} />
                  </button>
                  <button type="button" className="icon-button" aria-label={t('fitView')} title={t('fitView')} onClick={() => fitView({ padding: 0.18, maxZoom: 1, duration: 300 })}>
                    <Focus size={17} />
                  </button>
                </div>

                {canEdit && (
                  <div className="canvas-tool-dock">
                    <button type="button" title={t('addNote')} aria-label={t('addNote')} onClick={addNote}>
                      <StickyNote size={19} />
                    </button>
                    <button type="button" title={t('addTask')} aria-label={t('addTask')} onClick={() => void addTask()}>
                      <Plus size={20} />
                    </button>
                    <button type="button" title={t('addFromKanban')} aria-label={t('addFromKanban')} className="canvas-add-existing" popoverTarget="canvas-kanban-tasks">
                      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">playlist_add</span>
                      <span>{t('addFromKanban')}</span>
                    </button>
                    <div id="canvas-kanban-tasks" popover="auto" className="canvas-kanban-tasks p-4 rounded-xl bg-surface-container-high border border-outline-variant/60 shadow-2xl" aria-label={t('addFromKanban')} role="region">
                      <h2 className="mb-3 text-sm font-bold">{t('addFromKanban')}</h2>
                      {unplacedTasks.length === 0 ? (
                        <p className="text-xs text-on-surface-variant">{t('noUnplacedTasks')}</p>
                      ) : (
                        <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                          {unplacedTasks.map((task) => (
                            <button
                              key={task.id}
                              type="button"
                              className="unplaced-task"
                              disabled={canvas.loading || Boolean(canvas.error)}
                              onClick={(event) => {
                                event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
                                addTaskNode(task.id);
                              }}
                            >
                              <span className="truncate">{task.title}</span>
                              <Plus size={14} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button type="button" title="Mở chi tiết" aria-label="Mở bảng chi tiết" onClick={() => setMobilePanelOpen(true)}>
                      <span className="material-symbols-outlined text-[20px]">side_navigation</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeView === 'kanban' && (
              <>
                {/* HEADER SECTION: TITLE, OVERVIEW STATS & PRIMARY ACTIONS */}
                <div className="flex flex-col gap-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    {/* Page Title & Subtitle */}
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-surface-container-high to-surface-container border border-outline-variant/60 flex items-center justify-center text-primary shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
                        <span className="material-symbols-outlined text-[28px]">format_list_bulleted_add</span>
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-3">
                          <h1 className="text-2xl font-extrabold text-white tracking-tight">{t('tasksTitle')}</h1>
                          <span className="px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/30 text-primary text-xs font-bold">
                            {visibleTasks.length} / {boardTasks.length} {t('tasksCount')}
                          </span>
                        </div>
                        <p className="text-xs text-on-surface-variant font-normal">
                          {t('navBoardDescription')}
                        </p>
                      </div>
                    </div>

                    {/* Top-Right Actions: Collaborators, View Switcher & Add Task Button */}
                    <div className="flex items-center gap-3">
                      {/* View Switcher (Kanban / List / Calendar) */}
                      <div className="flex items-center bg-surface-container p-1 rounded-xl border border-outline-variant/50 gap-0.5">
                        <button
                          type="button"
                          aria-pressed={kanbanViewMode === 'kanban'}
                          onClick={() => setKanbanViewMode('kanban')}
                          className={`p-1.5 rounded-lg transition-all ${
                            kanbanViewMode === 'kanban'
                              ? 'bg-surface-container-highest text-primary shadow-sm'
                              : 'text-on-surface-variant hover:text-white hover:bg-surface-container-high'
                          }`}
                          title="Dạng bảng Kanban"
                        >
                          <span className="material-symbols-outlined text-[18px]">view_column</span>
                        </button>
                        <button
                          type="button"
                          aria-pressed={kanbanViewMode === 'list'}
                          onClick={() => setKanbanViewMode('list')}
                          className={`p-1.5 rounded-lg transition-all ${
                            kanbanViewMode === 'list'
                              ? 'bg-surface-container-highest text-primary shadow-sm'
                              : 'text-on-surface-variant hover:text-white hover:bg-surface-container-high'
                          }`}
                          title="Dạng danh sách"
                        >
                          <span className="material-symbols-outlined text-[18px]">view_agenda</span>
                        </button>
                        <button
                          type="button"
                          aria-pressed={kanbanViewMode === 'calendar'}
                          onClick={() => setKanbanViewMode('calendar')}
                          className={`p-1.5 rounded-lg transition-all ${
                            kanbanViewMode === 'calendar'
                              ? 'bg-surface-container-highest text-primary shadow-sm'
                              : 'text-on-surface-variant hover:text-white hover:bg-surface-container-high'
                          }`}
                          title="Lịch biểu"
                        >
                          <span className="material-symbols-outlined text-[18px]">calendar_month</span>
                        </button>
                      </div>

                      {/* Primary Global Add Button */}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setIsNewTaskModalOpen(true)}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary to-[#51c6b8] hover:brightness-105 text-slate-950 font-extrabold text-xs shadow-[0_4px_16px_rgba(107,216,203,0.3)] active:scale-95 transition-all"
                        >
                          <span className="material-symbols-outlined text-[19px]">add_circle</span>
                          <span>Thêm công việc</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="inline-flex rounded-xl border border-outline-variant/40 bg-surface-container p-1" role="group" aria-label={t('navTaskScope')}>
                      <button type="button" aria-pressed={!myTasksOnly} onClick={() => setMyTasksOnly(false)} className={`rounded-lg px-4 py-2 text-xs font-bold ${!myTasksOnly ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>{t('navAllTasks')}</button>
                      <button type="button" aria-pressed={myTasksOnly} onClick={() => setMyTasksOnly(true)} className={`rounded-lg px-4 py-2 text-xs font-bold ${myTasksOnly ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>{t('navMyTasksFilter')}</button>
                    </div>
                    {(myTasksOnly || hasFilters) && <button type="button" onClick={() => { setMyTasksOnly(false); setSearchQuery(''); setPriorityFilter(''); setDueFilter(''); setAssigneeFilter(''); }} className="text-xs font-semibold text-primary underline underline-offset-4">{t('navClearFilters')}</button>}
                  </div>
                  {myTasksOnly && <p className="text-xs text-on-surface-variant" role="status">{t('myTasksDescription')}</p>}

                  {/* TOOLBAR & ADVANCED FILTER STRIP */}
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-container-low/90 border border-outline-variant/50 p-2.5 rounded-2xl shadow-sm">
                    {/* Search input with Cmd+K shortcut */}
                    <div className="flex items-center gap-2 flex-1 min-w-[280px] max-w-md">
                      <div className="relative w-full">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
                          search
                        </span>
                        <input
                          aria-label="Tìm công việc"
                          ref={searchInputRef}
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setFilteredTasks(null);
                            setFilterError(false);
                          }}
                          className="w-full bg-surface-container/90 border border-outline-variant/40 pl-9 pr-14 py-2 rounded-xl text-white text-xs placeholder:text-on-surface-variant/70 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40 transition-all"
                          placeholder="Tìm theo tên công việc, #nhãn, người phụ trách..."
                          type="text"
                        />
                        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-surface-container-high border border-outline-variant/60 text-[10px] text-on-surface-variant font-mono">
                          ⌘K
                        </kbd>
                      </div>
                    </div>

                    {/* Filter Pills */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Filter Priority */}
                      <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container border border-outline-variant/40 text-on-surface-variant hover:text-white hover:border-primary/40 text-xs font-semibold transition-all cursor-pointer">
                        <span className="material-symbols-outlined text-[16px] text-amber-400">flag</span>
                        <select
                          aria-label="Mọi ưu tiên"
                          className="bg-transparent text-white border-0 outline-none cursor-pointer"
                          value={priorityFilter}
                          onChange={(e) => {
                            setPriorityFilter(e.target.value as TaskFilters['priority'] | '');
                            setFilteredTasks(null);
                          }}
                        >
                          <option value="" className="bg-surface-container text-white">
                            Mọi ưu tiên
                          </option>
                          <option value="high" className="bg-surface-container text-rose-300">
                            Ưu tiên: Cao
                          </option>
                          <option value="normal" className="bg-surface-container text-amber-300">
                            Ưu tiên: Trung bình
                          </option>
                          <option value="low" className="bg-surface-container text-teal-300">
                            Ưu tiên: Thấp
                          </option>
                        </select>
                      </label>

                      {/* Filter Assignee */}
                      <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container border border-outline-variant/40 text-on-surface-variant hover:text-white hover:border-primary/40 text-xs font-semibold transition-all cursor-pointer">
                        <span className="material-symbols-outlined text-[16px] text-indigo-400">person</span>
                        <select
                          aria-label="Mọi người thực hiện"
                          className="bg-transparent text-white border-0 outline-none cursor-pointer"
                          value={assigneeFilter}
                          onChange={(e) => {
                            setAssigneeFilter(e.target.value);
                            setFilteredTasks(null);
                          }}
                        >
                          <option value="" className="bg-surface-container text-white">
                            Người thực hiện
                          </option>
                          {members.map((m) => (
                            <option key={m.id} value={m.id} className="bg-surface-container text-white">
                              {m.displayName}
                            </option>
                          ))}
                        </select>
                      </label>

                      {/* Filter Due Date */}
                      <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container border border-outline-variant/40 text-on-surface-variant hover:text-white hover:border-primary/40 text-xs font-semibold transition-all cursor-pointer">
                        <span className="material-symbols-outlined text-[16px] text-primary">event</span>
                        <select
                          aria-label="Mọi hạn chót"
                          className="bg-transparent text-white border-0 outline-none cursor-pointer"
                          value={dueFilter}
                          onChange={(e) => {
                            setDueFilter(e.target.value as TaskFilters['due'] | '');
                            setFilteredTasks(null);
                          }}
                        >
                          <option value="" className="bg-surface-container text-white">
                            Hạn chót: Tất cả
                          </option>
                          <option value="overdue" className="bg-surface-container text-rose-300">
                            Quá hạn
                          </option>
                          <option value="today" className="bg-surface-container text-amber-300">
                            Hôm nay
                          </option>
                          <option value="upcoming" className="bg-surface-container text-teal-300">
                            Sắp tới
                          </option>
                        </select>
                      </label>

                      <div className="h-4 w-[1px] bg-outline-variant/60 hidden lg:block" />

                      {/* Project Overall Progress Bar */}
                      <div className="flex items-center gap-3 px-3 py-1.5 rounded-xl bg-surface-container/60 border border-outline-variant/30 text-xs">
                        <span className="text-on-surface-variant font-medium">Tiến độ dự án:</span>
                        <div className="w-24 h-2 bg-surface-container-highest rounded-full overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-primary to-emerald-400 h-full rounded-full transition-all duration-500"
                            style={{ width: `${completionPercent}%` }}
                          />
                        </div>
                        <span className="font-bold text-primary font-mono">
                          {completedCount} / {boardTasks.length} ({completionPercent}%)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* KANBAN BOARD OR LIST/CALENDAR VIEW */}
                <div className="w-full">
                  <KanbanBoard
                    key={workspace.id}
                    now={now}
                    tasks={visibleTasks}
                    members={members}
                    blockedBy={blockedBy}
                    selectedTaskId={selectedTaskId}
                    canEdit={canEdit && !server.savingId}
                    viewMode={kanbanViewMode}
                    onCreateTask={async (status, title) => {
                      const created = await server.create(status, title);
                      if (!created) return false;
                      setSelectedTaskId(created.id);
                      setMobilePanelOpen(true);
                      return true;
                    }}
                    onSelectTask={(id) => {
                      setActiveView('kanban');
                      setSelectedTaskId(id);
                      const draft = window.sessionStorage.getItem(draftKey(id));
                      setTaskDraftId(draft === null ? null : id);
                      setTaskDraft(draft ?? '');
                      setMobilePanelOpen(true);
                    }}
                    onMoveTask={moveTask}
                  />
                </div>

                {/* BOARD FOOTER STATUS BAR */}
                <footer className="flex flex-wrap items-center justify-between bg-surface-container-low/80 border border-outline-variant/40 px-5 py-3 rounded-2xl text-on-surface-variant text-xs gap-3 mt-auto">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span className="font-medium text-slate-200">Không gian làm việc riêng tư</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-on-surface-variant">Phím tắt nhanh:</span>
                    <div className="flex items-center gap-1.5">
                      <kbd className="px-2 py-0.5 rounded-md bg-surface-container border border-outline-variant/50 text-white font-mono text-[11px]">
                        N
                      </kbd>
                      <span className="text-[11px]">Thẻ mới</span>
                      <kbd className="px-2 py-0.5 rounded-md bg-surface-container border border-outline-variant/50 text-white font-mono text-[11px] ml-1">
                        F
                      </kbd>
                      <span className="text-[11px]">Tìm kiếm</span>
                      <kbd className="px-2 py-0.5 rounded-md bg-surface-container border border-outline-variant/50 text-white font-mono text-[11px] ml-1">
                        Esc
                      </kbd>
                      <span className="text-[11px]">Đóng</span>
                    </div>
                  </div>
                </footer>
              </>
            )}
          </main>
        </div>

        {/* ================= DETAIL INSPECTOR PANEL ================= */}
        <aside
          className={`detail-inspector-drawer fixed right-0 top-0 h-full w-[360px] bg-surface-container-low/95 backdrop-blur-2xl border-l border-outline-variant/50 z-50 flex flex-col transition-transform duration-300 shadow-2xl ${
            mobilePanelOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
          aria-label={t('inspector')}
        >
          <div className="flex items-center justify-between p-5 border-b border-outline-variant/30">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-bold tracking-wider text-primary">
                {activeView === 'canvas' && selectedEdge
                  ? t('relation')
                  : activeView === 'canvas' && selectedNode?.type === 'sticky'
                  ? t('note')
                  : selectedTask
                  ? 'Chi tiết công việc'
                  : t('inspector')}
              </span>
              <h2 className="text-base font-bold text-white truncate max-w-[260px]">
                {selectedTask?.title || selectedNode?.id || 'Thông tin'}
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              {selectedTask && (
                <button
                  type="button"
                  onClick={handleCopyTaskLink}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                    isLinkCopied
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-surface-container border-outline-variant/40 text-on-surface-variant hover:text-white hover:border-primary/50'
                  }`}
                  title={isLinkCopied ? t('linkCopied') : t('copyTaskLink')}
                  aria-label={t('copyTaskLink')}
                >
                  {isLinkCopied ? <Check size={13} className="text-emerald-400" /> : <Link2 size={13} />}
                  <span>{isLinkCopied ? t('linkCopied') : t('copyTaskLink')}</span>
                </button>
              )}
              <button
                type="button"
                className="w-8 h-8 rounded-lg text-on-surface-variant hover:text-white hover:bg-surface-container-high transition-all flex items-center justify-center"
                onClick={() => setMobilePanelOpen(false)}
                aria-label="Đóng bảng chi tiết"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 text-xs">
            {activeView === 'canvas' && selectedEdge ? (
              <div className="flex flex-col gap-3">
                <span className="text-on-surface-variant font-semibold">Loại liên kết</span>
                <p className="p-3 rounded-xl bg-surface-container border border-outline-variant/40 text-slate-200">
                  {nodeLabel(selectedEdge.source)} → {nodeLabel(selectedEdge.target)}
                </p>
                {canEdit && (
                  <button
                    type="button"
                    className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 font-bold transition-all flex items-center justify-center gap-2 mt-4"
                    onClick={() => {
                      setEdges((curr) => curr.filter((e) => e.id !== selectedEdge.id));
                      setSelectedEdgeId(null);
                      setMobilePanelOpen(false);
                    }}
                  >
                    <Trash2 size={16} />
                    <span>{t('deleteRelation')}</span>
                  </button>
                )}
              </div>
            ) : activeView === 'canvas' && selectedNode?.type === 'sticky' ? (
              <div className="flex flex-col gap-3">
                <label htmlFor="note-content" className="text-on-surface-variant font-semibold">Nội dung ghi chú</label>
                <textarea
                  id="note-content"
                  className="w-full bg-surface-container border border-outline-variant/40 rounded-xl p-3 text-white focus:outline-none focus:border-primary/60"
                  rows={6}
                  value={selectedNode.data.text}
                  disabled={!canEdit}
                  onChange={(e) => updateNote({ text: e.target.value })}
                />
                <div className="flex gap-2">
                  {(['yellow', 'green', 'pink'] as const).map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`w-8 h-8 rounded-lg border-2 ${selectedNode.data.color === color ? 'border-primary' : 'border-transparent'}`}
                      style={{
                        backgroundColor: color === 'yellow' ? '#fde047' : color === 'green' ? '#86efac' : '#f472b6',
                      }}
                      onClick={() => updateNote({ color })}
                    />
                  ))}
                </div>
                {canEdit && !selectedNode.data.taskId && (
                  <button
                    type="button"
                    className="p-2.5 rounded-xl bg-primary text-on-primary font-bold transition-all flex items-center justify-center gap-2 mt-2"
                    disabled={canvas.loading || canvas.state !== 'saved' || Boolean(canvas.error) || Boolean(server.savingId)}
                    onClick={() => void convertNote()}
                  >
                    <Plus size={16} />
                    <span>Chuyển thành công việc</span>
                  </button>
                )}
              </div>
            ) : selectedTask ? (
              <div className="flex flex-col gap-3.5">
                {server.error && (
                  <div role="alert" className="flex items-center justify-between gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-2.5 text-rose-200">
                    <span>{server.error === 'conflict' ? t('taskConflict') : t('saveFailed')}</span>
                    <button type="button" className="shrink-0 font-semibold underline" disabled={Boolean(server.savingId)} onClick={() => void retrySelectedTaskSave()}>{t('retry')}</button>
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <label htmlFor="task-title" className="text-on-surface-variant font-semibold">Tiêu đề</label>
                  <input
                    id="task-title"
                    className="w-full bg-surface-container border border-outline-variant/40 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-primary/60"
                    value={boardDraft}
                    disabled={!canEdit || Boolean(server.savingId)}
                    onChange={(e) => {
                      setTaskDraftId(selectedTask.id);
                      setTaskDraft(e.target.value);
                      window.sessionStorage.setItem(draftKey(selectedTask.id), e.target.value);
                    }}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="task-description" className="text-on-surface-variant font-semibold">Mô tả chi tiết</label>
                  <textarea
                    id="task-description"
                    className="w-full bg-surface-container border border-outline-variant/40 rounded-xl p-3 text-white focus:outline-none focus:border-primary/60"
                    rows={3}
                    value={descriptionDraft?.taskId === selectedTask.id ? descriptionDraft.value : selectedServerTask?.description ?? ''}
                    disabled={!canEdit || Boolean(server.savingId)}
                    onChange={(e) => setDescriptionDraft({ taskId: selectedTask.id, value: e.target.value })}
                    onBlur={(e) => {
                      const desc = e.target.value.trim();
                      const taskId = selectedTask.id;
                      void server.change(taskId, { description: desc || null }).then((saved) => {
                        if (saved) setDescriptionDraft((current) => current?.taskId === taskId && current.value.trim() === desc ? null : current);
                      });
                    }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="task-status" className="text-on-surface-variant font-semibold">Trạng thái</label>
                    <select
                      id="task-status"
                      className="bg-surface-container border border-outline-variant/40 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-primary/60"
                      value={selectedTask.status}
                      disabled={!canEdit || Boolean(server.savingId)}
                      onChange={(e) => updateTask({ status: e.target.value as TaskStatus })}
                    >
                      <option value="TODO">Cần làm</option>
                      <option value="IN_PROGRESS">Đang làm</option>
                      <option value="DONE">Hoàn thành</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="task-priority" className="text-on-surface-variant font-semibold">Mức ưu tiên</label>
                    <select
                      id="task-priority"
                      className="bg-surface-container border border-outline-variant/40 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-primary/60"
                      value={selectedServerTask?.priority ?? 'normal'}
                      disabled={!canEdit || Boolean(server.savingId)}
                      onChange={(e) => void server.change(selectedTask.id, { priority: e.target.value as ServerTask['priority'] })}
                    >
                      <option value="high">Cao</option>
                      <option value="normal">Trung bình</option>
                      <option value="low">Thấp</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="task-due" className="text-on-surface-variant font-semibold">Hạn chót</label>
                  <input
                    id="task-due"
                    type="date"
                    className={`bg-surface-container border rounded-xl px-3 py-2 text-white focus:outline-none focus:border-primary/60 ${
                      selectedTask.dueAt && new Date(selectedTask.dueAt).getTime() < now && selectedTask.status !== 'DONE'
                        ? 'border-rose-500/50 text-rose-300'
                        : 'border-outline-variant/40'
                    }`}
                    value={selectedServerTask?.dueAt?.slice(0, 10) ?? ''}
                    disabled={!canEdit || Boolean(server.savingId)}
                    onChange={(e) =>
                      void server.change(selectedTask.id, {
                        dueAt: e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : null,
                      })
                    }
                  />
                  {selectedTask.dueAt && new Date(selectedTask.dueAt).getTime() < now && selectedTask.status !== 'DONE' && (
                    <span className="text-[11px] text-rose-400 font-medium flex items-center gap-1 mt-1 bg-rose-500/10 px-2 py-1 rounded-lg border border-rose-500/20">
                      <span className="material-symbols-outlined text-[14px]">alarm</span>
                      Đã quá hạn ({Math.max(1, Math.round((now - new Date(selectedTask.dueAt).getTime()) / (1000 * 60 * 60 * 24)))} ngày) — Tự động cắm cờ Điểm nghẽn
                    </span>
                  )}
                </div>

                {/* Vướng mắc thủ công */}
                <div className="flex flex-col gap-1">
                  <label htmlFor="task-blocked-reason" className="text-on-surface-variant font-semibold flex items-center gap-1.5 text-rose-300">
                    <span className="material-symbols-outlined text-[15px]">warning</span>
                    <span>Lý do vướng mắc (Nghẽn tiến độ)</span>
                  </label>
                  <textarea
                    id="task-blocked-reason"
                    rows={2}
                    className="w-full bg-surface-container border border-rose-500/40 rounded-xl p-2.5 text-white placeholder:text-rose-300/40 focus:outline-none focus:border-rose-500"
                    placeholder="Nhập nguyên nhân khiến công việc bị kẹt..."
                    value={blockedReasonDraft?.taskId === selectedTask.id ? blockedReasonDraft.value : selectedServerTask?.blockedReason ?? ''}
                    disabled={!canEdit || Boolean(server.savingId) || selectedTask.status === 'DONE'}
                    onChange={(e) => setBlockedReasonDraft({ taskId: selectedTask.id, value: e.target.value })}
                    onBlur={(e) => {
                      const reason = e.target.value.trim();
                      const taskId = selectedTask.id;
                      void server.change(taskId, { blockedReason: reason || null }).then((saved) => {
                        if (saved) setBlockedReasonDraft((current) => current?.taskId === taskId && current.value.trim() === reason ? null : current);
                      });
                    }}
                  />
                </div>

                {/* Phụ trách */}
                <div className="flex flex-col gap-2">
                  <label className="text-on-surface-variant font-semibold">Phân công thành viên</label>
                  <div className="flex flex-col gap-1.5 p-2 bg-surface-container rounded-xl border border-outline-variant/30 max-h-36 overflow-y-auto">
                    {members.map((member) => {
                      const checked = selectedServerTask?.assigneeIds?.includes(member.id) ?? false;
                      return (
                        <label key={member.id} className="flex items-center gap-2 p-1 rounded-lg hover:bg-surface-container-high cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!canEdit}
                            onChange={(e) => {
                              const curr = selectedServerTask?.assigneeIds ?? [];
                              void server.assign(
                                selectedTask.id,
                                e.target.checked ? [...curr, member.id] : curr.filter((id) => id !== member.id)
                              );
                            }}
                            className="rounded accent-primary"
                          />
                          <span className="text-xs text-slate-200">{member.displayName}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Subtasks Checklist */}
                <div className="flex flex-col gap-2 pt-2 border-t border-outline-variant/30">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">Nhiệm vụ con (Checklist)</span>
                    <span className="font-mono text-primary text-[11px]">
                      {selectedTask.checklist?.filter((i) => i.isDone).length ?? 0}/{selectedTask.checklist?.length ?? 0}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                    {selectedTask.checklist?.map((item) => (
                      <div key={item.id} className="task-checklist-item flex items-center justify-between gap-2 p-1.5 rounded-lg bg-surface-container">
                        <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={item.isDone}
                            disabled={!canEdit}
                            onChange={(e) =>
                              void server.checklist(selectedTask.id, {
                                type: 'update',
                                itemId: item.id,
                                changes: { isDone: e.target.checked },
                              })
                            }
                            className="accent-primary rounded"
                          />
                          <span className={`text-xs truncate ${item.isDone ? 'line-through text-on-surface-variant' : 'text-slate-200'}`}>
                            {item.title}
                          </span>
                        </label>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => void server.checklist(selectedTask.id, { type: 'remove', itemId: item.id })}
                            className="text-on-surface-variant hover:text-rose-400"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {canEdit && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const title = (checklistDraft?.taskId === selectedTask.id ? checklistDraft.value : '').trim();
                        if (!title) return;
                        void server.checklist(selectedTask.id, { type: 'add', title }).then((saved) => {
                          if (saved) setChecklistDraft(null);
                        });
                      }}
                      className="flex items-center gap-1.5 mt-1"
                    >
                      <input
                        aria-label="Thêm một bước"
                        placeholder="Thêm việc cần làm..."
                        className="flex-1 bg-surface-container border border-outline-variant/40 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        value={checklistDraft?.taskId === selectedTask.id ? checklistDraft.value : ''}
                        onChange={(e) => setChecklistDraft({ taskId: selectedTask.id, value: e.target.value })}
                      />
                      <button type="submit" aria-label="Thêm bước" className="px-2.5 py-1.5 bg-primary hover:bg-[#82e6d9] text-slate-950 rounded-lg font-extrabold text-xs transition-all">
                        +
                      </button>
                    </form>
                  )}
                </div>

                {/* Task Discussions & Comments */}
                <TaskCommentsSection
                  key={selectedTask.id}
                  workspaceId={workspace.id}
                  taskId={selectedTask.id}
                  canEdit={canEdit}
                  currentUserId={user?.id}
                  currentUserRole={workspace.role}
                  members={members}
                  lastCommentCreatedEvent={lastCommentCreated}
                />

                {activeView === 'canvas' && selectedNode?.type === 'task' && canEdit && (
                  <button
                    type="button"
                    className="p-2.5 rounded-xl bg-surface-container border border-outline-variant/40 hover:border-rose-400 text-rose-300 font-bold transition-all flex items-center justify-center gap-2 mt-2"
                    onClick={removeSelected}
                  >
                    <Trash2 size={16} />
                    <span>Gỡ khỏi Canvas (vẫn giữ thẻ)</span>
                  </button>
                )}

                {canEdit && (
                  <button
                    type="button"
                    aria-label="Chuyển vào thùng rác"
                    className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 font-bold transition-all flex items-center justify-center gap-2 mt-4"
                    onClick={() => void trashSelected('task')}
                  >
                    <Trash2 size={16} />
                    <span>Xóa vào thùng rác</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="py-16 text-center text-on-surface-variant flex flex-col items-center gap-3">
                <span className="material-symbols-outlined text-[32px] opacity-40">touch_app</span>
                <span>Chọn một thẻ để xem và chỉnh sửa thông tin</span>
              </div>
            )}

            {activeView === 'canvas' && unplacedTasks.length > 0 && (
              <div className="pt-3 border-t border-outline-variant/30 flex flex-col gap-2">
                <span className="text-on-surface-variant font-semibold">Công việc chưa đưa lên Canvas ({unplacedTasks.length})</span>
                <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
                  {unplacedTasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => addTaskNode(t.id)}
                      className="flex items-center justify-between p-2 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-left text-xs text-white"
                    >
                      <span className="truncate">{t.title}</span>
                      <Plus size={14} className="text-primary shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ================= MODAL: QUẢN LÝ TẤT CẢ KHÔNG GIAN LÀM VIỆC (WORKSPACE HUB) ================= */}
        {isWorkspaceHubOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 modal-backdrop-smooth p-4">
            <div className="bg-surface-container-low border border-outline-variant/60 rounded-3xl max-w-2xl w-full shadow-2xl flex flex-col max-h-[85vh] overflow-hidden modal-dialog-smooth">
              {/* Header */}
              <div className="p-6 border-b border-outline-variant/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary to-primary-container flex items-center justify-center text-on-primary">
                    <Building2 size={20} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Quản lý Không gian làm việc</h2>
                    <p className="text-xs text-on-surface-variant">
                      Chuyển đổi, tạo mới, chỉnh sửa và quản lý các không gian bạn sở hữu hoặc tham gia.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsWorkspaceHubOpen(false)}
                  className="w-8 h-8 rounded-lg text-on-surface-variant hover:text-white hover:bg-surface-container flex items-center justify-center"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Tabs & Search */}
              <div className="px-6 pt-4 pb-2 flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/20">
                <div className="flex items-center gap-1 bg-surface-container p-1 rounded-xl text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setWorkspaceHubTab('all')}
                    className={`px-3 py-1.5 rounded-lg transition-all ${
                      workspaceHubTab === 'all' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-white'
                    }`}
                  >
                    Tất cả ({workspaces.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceHubTab('owned')}
                    className={`px-3 py-1.5 rounded-lg transition-all ${
                      workspaceHubTab === 'owned' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-white'
                    }`}
                  >
                    👑 Làm chủ ({ownedWorkspaces.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceHubTab('joined')}
                    className={`px-3 py-1.5 rounded-lg transition-all ${
                      workspaceHubTab === 'joined' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-white'
                    }`}
                  >
                    🤝 Tham gia ({joinedWorkspaces.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceHubTab('invitations')}
                    className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                      workspaceHubTab === 'invitations'
                        ? 'bg-primary text-on-primary'
                        : 'text-on-surface-variant hover:text-white'
                    }`}
                  >
                    <span>Lời mời</span>
                    {invitations.length > 0 && (
                      <span className="w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] flex items-center justify-center font-bold">
                        {invitations.length}
                      </span>
                    )}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setIsCreateWorkspaceModalOpen(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-primary to-[#51c6b8] text-on-primary text-xs font-bold flex items-center gap-1.5 shadow-sm hover:brightness-110"
                >
                  <Plus size={16} />
                  <span>Tạo không gian mới</span>
                </button>
              </div>

              {/* Body Content */}
              <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-3">
                {workspaceHubTab === 'invitations' ? (
                  invitations.length === 0 ? (
                    <div className="py-12 text-center text-on-surface-variant flex flex-col items-center gap-2">
                      <Mail size={32} className="opacity-40" />
                      <span>Không có lời mời tham gia workspace nào đang chờ.</span>
                    </div>
                  ) : (
                    invitations.map((inv) => (
                      <div
                        key={inv.id}
                        className="p-4 rounded-2xl bg-surface-container border border-outline-variant/40 flex items-center justify-between gap-4"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-primary/20 text-primary flex items-center justify-center font-bold">
                            <Mail size={20} />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold text-white text-sm truncate">
                              Lời mời tham gia không gian làm việc
                            </span>
                            <span className="text-xs text-on-surface-variant">
                              Vai trò được chỉ định: <strong className="text-primary">{inv.role}</strong>
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleDeclineInvitation(inv.id)}
                            className="px-3 py-1.5 rounded-xl border border-outline-variant/50 text-xs font-semibold text-on-surface-variant hover:text-white hover:bg-surface-container-high transition-colors"
                          >
                            Từ chối
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleAcceptInvitation(inv.id)}
                            className="px-4 py-1.5 rounded-xl bg-primary text-on-primary text-xs font-bold shadow-sm hover:brightness-110"
                          >
                            Chấp nhận tham gia
                          </button>
                        </div>
                      </div>
                    ))
                  )
                ) : filteredHubWorkspaces.length === 0 ? (
                  <div className="py-12 text-center text-on-surface-variant flex flex-col items-center gap-2">
                    <Building2 size={32} className="opacity-40" />
                    <span>Không tìm thấy không gian làm việc nào phù hợp.</span>
                  </div>
                ) : (
                  filteredHubWorkspaces.map((ws) => {
                    const isCurrent = ws.id === workspace.id;
                    const isOwner = ws.role === 'owner';

                    return (
                      <div
                        key={ws.id}
                        className={`p-4 rounded-2xl border transition-all flex flex-col gap-3 ${
                          isCurrent
                            ? 'bg-primary/10 border-primary/50 shadow-[0_0_15px_rgba(107,216,203,0.15)]'
                            : 'bg-surface-container border-outline-variant/40 hover:border-outline-variant'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-surface-container-highest border border-outline-variant/40 flex items-center justify-center text-primary font-bold text-base shrink-0">
                              {ws.name.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white text-sm truncate">{ws.name}</span>
                                {isCurrent && (
                                  <span className="px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30 flex items-center gap-1">
                                    <Check size={12} /> Đang mở
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-on-surface-variant line-clamp-1 mt-0.5">
                                {ws.description || 'Chưa có mô tả mục tiêu dự án.'}
                              </span>
                            </div>
                          </div>

                          <span
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold border shrink-0 ${
                              isOwner
                                ? 'bg-primary/15 border-primary/40 text-primary'
                                : ws.role === 'editor'
                                ? 'bg-secondary/15 border-secondary/40 text-secondary'
                                : 'bg-surface-container-highest border-outline-variant/50 text-slate-300'
                            }`}
                          >
                            {isOwner ? '👑 Chủ sở hữu' : ws.role === 'editor' ? 'Biên tập viên' : 'Người xem'}
                          </span>
                        </div>

                        {/* Card Actions */}
                        <div className="pt-2 border-t border-outline-variant/30 flex items-center justify-between text-xs">
                          <span className="text-[11px] text-on-surface-variant font-mono">
                            Mã: #{ws.id.slice(0, 8)}
                          </span>

                          <div className="flex items-center gap-2">
                            {isOwner ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setMembersDialogWorkspace(ws)}
                                  className="px-2.5 py-1 rounded-lg text-primary hover:bg-primary/10 font-semibold"
                                >
                                  {t('manageMembers')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingWorkspace({
                                      id: ws.id,
                                      name: ws.name,
                                      description: ws.description || '',
                                    })
                                  }
                                  className="px-2.5 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-surface-container-high transition-colors flex items-center gap-1"
                                >
                                  <Edit3 size={13} />
                                  <span>Sửa</span>
                                </button>
                                {workspaces.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => setWorkspaceToDelete(ws)}
                                    className="px-2.5 py-1 rounded-lg text-rose-300 hover:text-rose-200 hover:bg-rose-500/15 transition-colors flex items-center gap-1"
                                  >
                                    <Trash2 size={13} />
                                    <span>Xóa</span>
                                  </button>
                                )}
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setWorkspaceToLeave(ws)}
                                className="px-2.5 py-1 rounded-lg text-rose-300 hover:text-rose-200 hover:bg-rose-500/15 transition-colors flex items-center gap-1"
                              >
                                <LogOut size={13} />
                                <span>Rời khỏi</span>
                              </button>
                            )}

                            {!isCurrent && (
                              <button
                                type="button"
                                onClick={() => {
                                  onWorkspaceChange(ws.id);
                                  setIsWorkspaceHubOpen(false);
                                }}
                                className="px-3.5 py-1 rounded-lg bg-surface-container-high hover:bg-primary hover:text-on-primary text-primary font-bold transition-all border border-primary/30"
                              >
                                Chuyển tới →
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {membersDialogWorkspace && (
          <WorkspaceMembersDialog
            workspace={membersDialogWorkspace}
            currentUserId={user.id}
            onClose={() => setMembersDialogWorkspace(null)}
            onMembersChanged={() => {
              if (membersDialogWorkspace.id === workspace.id) void listAllMembers(workspace.id).then(setMembers);
            }}
          />
        )}

        {/* ================= MODAL: TẠO KHÔNG GIAN LÀM VIỆC MỚI ================= */}
        {isCreateWorkspaceModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 modal-backdrop-smooth p-4">
            <div className="bg-surface-container-high border border-outline-variant/60 rounded-3xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4 modal-dialog-smooth">
              <div className="flex items-center justify-between pb-2 border-b border-outline-variant/30">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center">
                    <Plus size={18} />
                  </div>
                  <h3 className="text-base font-bold text-white">Tạo không gian làm việc mới</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreateWorkspaceModalOpen(false)}
                  className="text-on-surface-variant hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleCreateWorkspace} className="flex flex-col gap-3.5 text-xs">
                <div className="flex flex-col gap-1">
                  <label htmlFor="create-ws-name" className="text-slate-200 font-bold">
                    Tên không gian làm việc <span className="text-primary">*</span>
                  </label>
                  <input
                    id="create-ws-name"
                    required
                    maxLength={120}
                    placeholder="Ví dụ: Dự án Thiết kế Sản phẩm 2026..."
                    value={createWsName}
                    onChange={(e) => setCreateWsName(e.target.value)}
                    className="bg-surface-container border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-white placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="create-ws-desc" className="text-slate-200 font-bold">
                    Mô tả mục tiêu (Tùy chọn)
                  </label>
                  <textarea
                    id="create-ws-desc"
                    rows={2}
                    maxLength={500}
                    placeholder="Mục đích và phạm vi công việc..."
                    value={createWsDesc}
                    onChange={(e) => setCreateWsDesc(e.target.value)}
                    className="bg-surface-container border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-white placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary"
                  />
                </div>

                {createWsError && (
                  <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">
                    {createWsError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsCreateWorkspaceModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-on-surface-variant hover:text-white hover:bg-surface-container text-xs font-semibold"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isCreatingWs || !createWsName.trim()}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-primary to-[#51c6b8] text-on-primary font-bold text-xs shadow-md hover:brightness-110 active:scale-95 transition-all"
                  >
                    {isCreatingWs ? 'Đang tạo...' : 'Tạo không gian'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================= MODAL: SỬA TÊN & MÔ TẢ KHÔNG GIAN ================= */}
        {editingWorkspace && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 modal-backdrop-smooth p-4">
            <div className="bg-surface-container-high border border-outline-variant/60 rounded-3xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4 modal-dialog-smooth">
              <div className="flex items-center justify-between pb-2 border-b border-outline-variant/30">
                <h3 className="text-base font-bold text-white">Chỉnh sửa thông tin không gian</h3>
                <button type="button" onClick={() => setEditingWorkspace(null)} className="text-on-surface-variant hover:text-white">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveWorkspaceEdit} className="flex flex-col gap-3.5 text-xs">
                <div className="flex flex-col gap-1">
                  <label htmlFor="edit-ws-name" className="text-slate-200 font-bold">
                    Tên không gian làm việc
                  </label>
                  <input
                    id="edit-ws-name"
                    required
                    maxLength={120}
                    value={editingWorkspace.name}
                    onChange={(e) => setEditingWorkspace({ ...editingWorkspace, name: e.target.value })}
                    className="bg-surface-container border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="edit-ws-desc" className="text-slate-200 font-bold">
                    Mô tả
                  </label>
                  <textarea
                    id="edit-ws-desc"
                    rows={2}
                    maxLength={500}
                    value={editingWorkspace.description}
                    onChange={(e) => setEditingWorkspace({ ...editingWorkspace, description: e.target.value })}
                    className="bg-surface-container border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingWorkspace(null)}
                    className="px-4 py-2 rounded-xl text-on-surface-variant hover:text-white"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={hubActionBusy || !editingWorkspace.name.trim()}
                    className="px-5 py-2 rounded-xl bg-primary text-on-primary font-bold text-xs shadow-md hover:brightness-110"
                  >
                    {hubActionBusy ? 'Đang lưu...' : 'Lưu thay đổi'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================= MODAL: XÁC NHẬN XÓA KHÔNG GIAN ================= */}
        {workspaceToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 modal-backdrop-smooth p-4">
            <div className="bg-surface-container-high border border-rose-500/40 rounded-3xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4 text-xs modal-dialog-smooth">
              <div className="flex items-center gap-3 text-rose-300">
                <AlertTriangle size={24} />
                <h3 className="text-base font-bold text-white">Xác nhận xóa Không gian làm việc</h3>
              </div>
              <p className="text-slate-300">
                Bạn có chắc chắn muốn xóa không gian <strong className="text-white font-bold">{workspaceToDelete.name}</strong> không? Toàn bộ thẻ Kanban, bản vẽ Canvas và tài liệu bên trong sẽ bị xóa vĩnh viễn và không thể khôi phục.
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWorkspaceToDelete(null)}
                  className="px-4 py-2 rounded-xl text-on-surface-variant hover:text-white"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={hubActionBusy}
                  onClick={handleDeleteWorkspace}
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold shadow-md"
                >
                  {hubActionBusy ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= MODAL: XÁC NHẬN RỜI KHÔNG GIAN ================= */}
        {workspaceToLeave && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 modal-backdrop-smooth p-4">
            <div className="bg-surface-container-high border border-outline-variant/60 rounded-3xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4 text-xs modal-dialog-smooth">
              <div className="flex items-center gap-3 text-amber-300">
                <LogOut size={22} />
                <h3 className="text-base font-bold text-white">Rời khỏi không gian làm việc</h3>
              </div>
              <p className="text-slate-300">
                Bạn sẽ không thể xem hoặc chỉnh sửa các công việc trong <strong className="text-white font-bold">{workspaceToLeave.name}</strong> nữa trừ khi được chủ sở hữu mời lại.
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWorkspaceToLeave(null)}
                  className="px-4 py-2 rounded-xl text-on-surface-variant hover:text-white"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={hubActionBusy}
                  onClick={handleLeaveWorkspace}
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold shadow-md"
                >
                  {hubActionBusy ? 'Đang xử lý...' : 'Xác nhận rời khỏi'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= MODAL: TẠO CÔNG VIỆC MỚI NHANH (N) ================= */}
        {isNewTaskModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 modal-backdrop-smooth p-4">
            <div className="bg-surface-container-high border border-outline-variant/60 rounded-2xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4 modal-dialog-smooth">
              <div className="flex items-center justify-between pb-2 border-b border-outline-variant/40">
                <div className="flex items-center gap-2 text-white font-bold text-base">
                  <span className="material-symbols-outlined text-primary">add_task</span>
                  <span>Tạo công việc mới</span>
                </div>
                <button type="button" onClick={() => setIsNewTaskModalOpen(false)} className="text-on-surface-variant hover:text-white">
                  <X size={18} />
                </button>
              </div>
              <div className="flex flex-col gap-3">
                <label className="text-xs text-on-surface-variant font-semibold">Tên công việc</label>
                <input
                  autoFocus
                  placeholder="Nhập tên công việc cần làm..."
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="bg-surface-container border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-primary/80"
                />
                <label className="text-xs text-on-surface-variant font-semibold">Trạng thái ban đầu</label>
                <select
                  value={newTaskStatus}
                  onChange={(e) => setNewTaskStatus(e.target.value as TaskStatus)}
                  className="bg-surface-container border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-primary/80"
                >
                  <option value="TODO">Cần làm (To-Do)</option>
                  <option value="IN_PROGRESS">Đang làm (In Progress)</option>
                  <option value="DONE">Hoàn thành (Done)</option>
                </select>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewTaskModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-white hover:bg-surface-container"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const title = newTaskTitle.trim();
                    if (!title) return;
                    const created = await server.create(newTaskStatus, title);
                    if (created) {
                      setNewTaskTitle('');
                      setIsNewTaskModalOpen(false);
                      setSelectedTaskId(created.id);
                      setMobilePanelOpen(true);
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-[#51c6b8] hover:brightness-105 text-slate-950 font-extrabold text-xs shadow-md active:scale-95 transition-all"
                >
                  Tạo thẻ ngay
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= MODAL: THÀNH VIÊN VÀ CỘNG TÁC ================= */}
        {/* ================= CONFIRMATION MODAL CHO SOFT BLOCKER ================= */}
        {pendingDoneTask && (
          <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-blocked-title">
            <div className="confirm-dialog confirm-blocked-dialog">
              <div className="confirm-blocked-header">
                <AlertTriangle size={24} className="warning-icon" />
                <h2 id="confirm-blocked-title">{t('confirmBlockedTitle')}</h2>
              </div>
              <p>{t('confirmBlockedDesc')}</p>
              <ul className="confirm-blocked-list">
                {pendingDoneTask.blockers.map((blocker) => (
                  <li key={blocker.id}>
                    <strong>{blocker.title}</strong> <span>({t(blocker.status)})</span>
                  </li>
                ))}
              </ul>
              <p className="confirm-blocked-question">{t('confirmBlockedQuestion')}</p>
              <div className="confirm-actions">
                <button type="button" className="secondary-action" onClick={() => setPendingDoneTask(null)}>
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  className="confirm-warning-btn"
                  onClick={() => {
                    const taskId = pendingDoneTask.id;
                    setPendingDoneTask(null);
                    setBlockedReasonDraft(null);
                    void server.move(taskId, 'DONE');
                  }}
                >
                  {t('proceedDone')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </TaskContext.Provider>
  );
}
