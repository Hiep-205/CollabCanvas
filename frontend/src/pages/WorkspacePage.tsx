import {
  addEdge,
  Background,
  BackgroundVariant,
  Connection,
  Edge,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import {
  Check,
  ChevronDown,
  CircleHelp,
  Focus,
  LayoutGrid,
  Moon,
  PanelRight,
  Plus,
  StickyNote,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePreferences } from '../app/Preferences';
import { nodeTypes } from '../features/canvas/nodes';
import { loadState, STORAGE_KEY } from '../features/canvas/prototypeStorage';
import type { CanvasNode, SavedState, StickyNode, TaskCardNode } from '../features/canvas/model';
import { TaskContext } from '../features/tasks/TaskContext';
import type { Task, TaskStatus } from '../features/tasks/model';

export default function WorkspacePage() {
  const { locale, setLocale, theme, setTheme, t } = usePreferences();
  const [saved] = useState(loadState);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(saved.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(saved.edges);
  const [tasks, setTasks] = useState<Task[]>(saved.tasks);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const canvasRef = useRef<HTMLDivElement>(null);
  const isCompact = window.matchMedia('(max-width: 700px)').matches;
  const { fitView, screenToFlowPosition, setCenter } = useReactFlow<CanvasNode, Edge>();

  const selectedNode = nodes.find((node) => node.id === selectedId);
  const selectedTask = selectedNode?.type === 'task' ? tasks.find((task) => task.id === selectedNode.data.taskId) : undefined;
  const placedTaskIds = useMemo(() => new Set(nodes.filter((node): node is TaskCardNode => node.type === 'task').map((node) => node.data.taskId)), [nodes]);
  const unplacedTasks = tasks.filter((task) => !placedTaskIds.has(task.id));

  useEffect(() => {
    const savingTimer = window.setTimeout(() => setSaveState('saving'), 0);
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, nodes, edges, tasks } satisfies SavedState));
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 450);
    return () => { window.clearTimeout(savingTimer); window.clearTimeout(timer); };
  }, [nodes, edges, tasks]);

  const nextPosition = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const center = screenToFlowPosition({ x, y });
    const offsets = [[0, 0], [300, 0], [0, 210], [-300, 0], [300, 210], [-300, 210], [0, -210], [300, -210], [-300, -210]];
    for (const [dx, dy] of offsets) {
      const candidate = { x: center.x + dx, y: center.y + dy };
      if (nodes.every((node) => Math.abs(node.position.x - candidate.x) >= 265 || Math.abs(node.position.y - candidate.y) >= 185)) {
        return candidate;
      }
    }
    return { x: center.x + nodes.length * 35, y: center.y + nodes.length * 35 };
  }, [nodes, screenToFlowPosition]);

  const addNote = useCallback(() => {
    const id = crypto.randomUUID();
    const position = nextPosition();
    setNodes((current) => [...current, { id, type: 'sticky', position, data: { text: t('newNote'), color: 'yellow' } }]);
    void setCenter(position.x + 122, position.y + 80, { zoom: isCompact ? 0.85 : 1, duration: 300 });
    setSelectedId(id);
    setMobilePanelOpen(true);
  }, [isCompact, nextPosition, setCenter, setNodes, t]);

  const addTaskNode = useCallback((taskId: string) => {
    const id = crypto.randomUUID();
    const position = nextPosition();
    setNodes((current) => [...current, { id, type: 'task', position, data: { taskId } }]);
    void setCenter(position.x + 123, position.y + 72, { zoom: isCompact ? 0.85 : 1, duration: 300 });
    setSelectedId(id);
    setMobilePanelOpen(true);
  }, [isCompact, nextPosition, setCenter, setNodes]);

  const addTask = useCallback(() => {
    const taskId = crypto.randomUUID();
    setTasks((current) => [...current, { id: taskId, title: t('newTask'), status: 'TODO' }]);
    addTaskNode(taskId);
  }, [addTaskNode, t]);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedId));
    setEdges((current) => current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId));
    setSelectedId(null);
  }, [selectedId, setEdges, setNodes]);

  const updateNote = (patch: Partial<StickyNode['data']>) => {
    if (!selectedId) return;
    setNodes((current) => current.map((node) => node.id === selectedId && node.type === 'sticky'
      ? { ...node, data: { ...node.data, ...patch } } : node));
  };

  const updateTask = (patch: Partial<Omit<Task, 'id'>>) => {
    if (!selectedTask) return;
    setTasks((current) => current.map((task) => task.id === selectedTask.id ? { ...task, ...patch } : task));
  };

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({ ...connection, type: 'smoothstep', style: { stroke: '#667c7b', strokeWidth: 2 } }, current));
  }, [setEdges]);

  return (
    <TaskContext.Provider value={tasks}>
      <div className="app-shell flex h-dvh min-h-[600px] flex-col overflow-hidden text-[var(--ink)]">
        <header className="topbar relative z-20 flex h-[70px] shrink-0 items-center gap-4 px-5">
          <div className="brand flex items-center gap-2.5 whitespace-nowrap"><span className="brand-mark grid size-9 place-items-center rounded-xl"><LayoutGrid size={19} strokeWidth={2.4} /></span><span>CollabCanvas</span></div>
          <div className="topbar-divider" />
          <div className="workspace-switch flex items-center gap-2.5" title={t('currentWorkspace')}><span className="workspace-initial grid size-7 place-items-center rounded-lg">D</span><span>{t('workspace')}</span><ChevronDown size={15} /></div>
          <div className="topbar-spacer" />
          <span className={`save-indicator save-${saveState} flex items-center gap-2 whitespace-nowrap`} role="status"><span className="save-dot" />{saveState === 'saved' ? t('localSaved') : saveState === 'saving' ? t('saving') : t('saveFailed')}</span>
          <div className="language-switch flex items-center rounded-full p-1" role="group" aria-label={t('language')}>
            <button type="button" className={locale === 'vi' ? 'is-active' : ''} aria-pressed={locale === 'vi'} onClick={() => setLocale('vi')}>VI</button>
            <button type="button" className={locale === 'en' ? 'is-active' : ''} aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button>
          </div>
          <button className="theme-toggle icon-button grid size-9 place-items-center rounded-full" type="button" title={theme === 'light' ? t('darkMode') : t('lightMode')} aria-label={theme === 'light' ? t('darkMode') : t('lightMode')} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button>
          <button className="mobile-panel-toggle icon-button" type="button" title={mobilePanelOpen ? t('closeDetails') : t('openDetails')} onClick={() => setMobilePanelOpen((open) => !open)}><PanelRight size={20} /></button>
          <span className="avatar grid size-8 place-items-center rounded-full" title={t('sampleAccount')}>H</span>
        </header>

        <div className="main-area flex min-h-0 flex-1">
          <aside className="tool-rail flex w-[68px] shrink-0 flex-col items-center gap-3 py-5" aria-label={t('canvasTools')}>
            <button className="tool-button active" type="button" title={t('canvas')} aria-label={t('canvas')}><LayoutGrid size={20} /></button>
            <div className="rail-separator" />
            <button className="tool-button" type="button" title={t('addNote')} aria-label={t('addNote')} onClick={addNote}><StickyNote size={20} /></button>
            <button className="tool-button" type="button" title={t('addTask')} aria-label={t('addTask')} onClick={addTask}><Check size={20} /></button>
            <button className="tool-button" type="button" title={t('fitView')} aria-label={t('fitView')} onClick={() => fitView({ padding: 0.25, duration: 300 })}><Focus size={20} /></button>
            <div className="rail-spacer" />
            <button className="tool-button" type="button" title={t('help')} aria-label={t('help')} onClick={() => window.alert(t('helpText'))}><CircleHelp size={20} /></button>
          </aside>

          <main className="canvas-stage relative flex min-w-0 flex-1 flex-col" ref={canvasRef}>
            <div className="canvas-heading flex shrink-0 items-end justify-between gap-4 px-8 pb-5 pt-7"><div><span className="eyebrow">{t('workspaceEyebrow')}</span><h1>{t('boardTitle')}</h1></div><span className="canvas-count">{nodes.length} {t('canvasItems')}</span></div>
            <div className="canvas-surface relative min-h-0 flex-1 overflow-hidden rounded-xl">
              <ReactFlow<CanvasNode, Edge>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, node) => { setSelectedId(node.id); setMobilePanelOpen(true); }}
                onPaneClick={() => { setSelectedId(null); setMobilePanelOpen(false); }}
                fitView={!isCompact}
                fitViewOptions={{ padding: 0.28 }}
                defaultViewport={isCompact ? { x: -72, y: 98, zoom: 0.85 } : undefined}
                minZoom={0.35}
                maxZoom={2}
                connectionLineStyle={{ stroke: '#548c88', strokeWidth: 2 }}
                deleteKeyCode={null}
              >
                <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="var(--canvas-dot)" />
                <MiniMap pannable zoomable nodeColor={(node) => node.type === 'sticky' ? '#e4ad63' : '#4caaa0'} />
              </ReactFlow>
            </div>
          </main>

          <aside className={`detail-panel flex w-[300px] shrink-0 flex-col overflow-auto ${mobilePanelOpen ? 'panel-open' : ''}`}>
            <div className="panel-heading flex items-start justify-between gap-3 px-6 pb-5 pt-7"><div><span className="eyebrow">{t('detailsEyebrow')}</span><h2>{selectedNode ? selectedNode.type === 'sticky' ? t('note') : t('task') : t('inspector')}</h2></div><button className="icon-button panel-close" type="button" title={t('closeDetails')} aria-label={t('closeDetails')} onClick={() => setMobilePanelOpen(false)}><X size={17} /></button>{selectedNode && <button className="icon-button desktop-clear" type="button" title={t('clearSelection')} aria-label={t('clearSelection')} onClick={() => setSelectedId(null)}><X size={17} /></button>}</div>
            {selectedNode?.type === 'sticky' ? (
              <div className="panel-body flex flex-col px-6 py-6">
                <label className="field-label" htmlFor="note-text">{t('content')}</label>
                <textarea id="note-text" className="text-area" rows={7} value={selectedNode.data.text} onChange={(event) => updateNote({ text: event.target.value })} />
                <span className="field-label">{t('noteColor')}</span>
                <div className="swatch-row flex gap-3">{(['yellow', 'green', 'pink'] as const).map((color) => <button key={color} type="button" className={`swatch swatch-${color} ${selectedNode.data.color === color ? 'chosen' : ''}`} title={t(color)} aria-label={t(color)} aria-pressed={selectedNode.data.color === color} onClick={() => updateNote({ color })}>{selectedNode.data.color === color && <Check size={16} />}</button>)}</div>
                <button className="danger-action" type="button" onClick={removeSelected}><Trash2 size={16} /> {t('deleteNote')}</button>
              </div>
            ) : selectedNode?.type === 'task' ? (
              <div className="panel-body flex flex-col px-6 py-6">
                <label className="field-label" htmlFor="task-title">{t('title')}</label>
                <input id="task-title" className="text-input" value={selectedTask?.title ?? ''} onChange={(event) => updateTask({ title: event.target.value })} />
                <label className="field-label" htmlFor="task-status">{t('status')}</label>
                <select id="task-status" className="text-input" value={selectedTask?.status ?? 'TODO'} onChange={(event) => updateTask({ status: event.target.value as TaskStatus })}>
                  {(['TODO', 'IN_PROGRESS', 'DONE'] as const).map((value) => <option key={value} value={value}>{t(value)}</option>)}
                </select>
                <button className="danger-action" type="button" onClick={removeSelected}><Trash2 size={16} /> {t('removeFromCanvas')}</button>
                <p className="panel-note">{t('taskRemains')}</p>
              </div>
            ) : (
              <div className="panel-body empty-detail flex flex-col items-center px-6 py-9 text-center"><div className="empty-icon"><LayoutGrid size={25} /></div><strong>{t('noSelection')}</strong></div>
            )}
            <div className="panel-section">
              <div className="section-heading"><h3>{t('unplaced')}</h3><span>{unplacedTasks.length}</span></div>
              {unplacedTasks.length === 0 ? <p className="muted-copy">{t('allPlaced')}</p> : unplacedTasks.map((task) => <button className="unplaced-task" type="button" key={task.id} onClick={() => addTaskNode(task.id)} title={t('placeOnCanvas')}><span className="small-task-icon"><Check size={14} /></span><span>{task.title}</span><Plus size={16} /></button>)}
            </div>
          </aside>
        </div>
      </div>
    </TaskContext.Provider>
  );
}
