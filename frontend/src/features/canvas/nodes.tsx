import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Check, MoreHorizontal } from 'lucide-react';
import { useContext } from 'react';
import { usePreferences } from '../../app/Preferences';
import { TaskContext } from '../tasks/TaskContext';
import type { StickyNode, TaskCardNode } from './model';

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
  const tasks = useContext(TaskContext);
  const task = tasks.find((item) => item.id === data.taskId);
  return (
    <div className={`canvas-node task-card ${selected ? 'is-selected' : ''}`}>
      <NodeHandle side="left" />
      <div className="task-card-top"><span className="task-icon"><Check size={14} strokeWidth={2.5} /></span><span>{t('task').toUpperCase()}</span><MoreHorizontal size={16} /></div>
      <strong>{task?.title ?? t('missingTask')}</strong>
      <span className={`status-pill status-${task?.status ?? 'TODO'}`}>{t(task?.status ?? 'TODO')}</span>
      <NodeHandle side="right" />
    </div>
  );
}

export const nodeTypes = { sticky: StickyCard, task: TaskCard };
