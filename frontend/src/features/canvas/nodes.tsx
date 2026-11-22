import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { AlertTriangle, Check, ListChecks, MoreHorizontal } from 'lucide-react';
import { useContext } from 'react';
import { usePreferences } from '../../app/Preferences';
import { TaskContext } from '../tasks/TaskContext';
import type { StickyNode, TaskCardNode } from './model';
import { isBottleneckTask } from './relationships';

function NodeHandle({ side }: { side: 'left' | 'right' }) {
  return <Handle type={side === 'left' ? 'target' : 'source'} position={side === 'left' ? Position.Left : Position.Right} className="node-handle" />;
}

function StickyCard({ data, selected }: NodeProps<StickyNode>) {
  const { t } = usePreferences();
  return (
    <div className={`canvas-node sticky-card sticky-${data.color} ${selected ? 'is-selected' : ''}`}>
      <NodeHandle side="left" />
      <span className="sticky-label">{t('note').toUpperCase()}</span>
      <p>{data.text || t('newNote')}</p>
      <NodeHandle side="right" />
    </div>
  );
}

function TaskCard({ data, selected }: NodeProps<TaskCardNode>) {
  const { t } = usePreferences();
  const { tasks, blockedBy, now } = useContext(TaskContext);
  const task = tasks.find((item) => item.id === data.taskId);
  const blockers = blockedBy.get(data.taskId) ?? [];
  const isBottleneck = isBottleneckTask(task, now);
  return (
    <div className={`canvas-node task-card ${selected ? 'is-selected' : ''} ${isBottleneck ? 'is-bottleneck' : ''}`}>
      <NodeHandle side="left" />
      <div className="task-card-top">
        <span className="task-icon"><Check size={14} strokeWidth={2.5} /></span>
        <span>{t('task').toUpperCase()}</span>
        {isBottleneck && <span className="bottleneck-indicator" title={t('bottleneckTooltip')}>⚠️ {t('bottleneck')}</span>}
        <MoreHorizontal size={16} />
      </div>
      <strong>{task?.title ?? t('missingTask')}</strong>
      {task?.description && <p className="task-card-description" title={task.description}>{task.description}</p>}
      <div className="task-card-bottom"><span className={`status-pill status-${task?.status ?? 'TODO'}`}>{t(task?.status ?? 'TODO')}</span>
        {task?.checklist && task.checklist.length > 0 && <span className="checklist-badge" title={t('checklistProgress')}><ListChecks size={13} />{task.checklist.filter((item) => item.isDone).length}/{task.checklist.length}</span>}
        {task?.blockedReason && <span className="blocked-badge manual-blocked-badge" title={task.blockedReason}><AlertTriangle size={13} />{t('manualBlock')}</span>}
        {blockers.length > 0 && <span className="blocked-badge" title={blockers.map((item) => item.title).join(', ')}><AlertTriangle size={13} />{t('blockedByCount')} {blockers.length}</span>}</div>
      <NodeHandle side="right" />
    </div>
  );
}

export const nodeTypes = { sticky: StickyCard, task: TaskCard };
