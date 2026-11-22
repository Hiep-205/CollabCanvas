import { Activity, ArrowRight, ListFilter, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { usePreferences } from '../../app/Preferences';
import type { Task } from '../tasks/model';
import { listActivity } from './api';
import type { ActivityEvent } from './api';

type Props = { workspaceId: string; tasks: Task[] };

const actionKeys = {
  task_created: 'activityTaskCreated',
  task_updated: 'activityTaskUpdated',
  task_status_changed: 'activityStatusChanged',
  task_assignees_changed: 'activityAssigneesChanged',
  checklist_changed: 'activityChecklistChanged',
  task_trashed: 'activityTaskTrashed',
  task_restored: 'activityTaskRestored',
} as const;

const statusKeys = { todo: 'TODO', in_progress: 'IN_PROGRESS', done: 'DONE' } as const;

export default function ActivityView({ workspaceId, tasks }: Props) {
  const { locale, t } = usePreferences();
  const [taskId, setTaskId] = useState('');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    void listActivity(workspaceId, 1, taskId || undefined).then((result) => {
      if (active) { setEvents(result.items); setNextPage(result.nextPage); setError(false); }
    }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, taskId, reloadToken]);

  const taskOptions = useMemo(() => {
    const options = new Map(tasks.map((task) => [task.id, task.title]));
    for (const event of events) if (!options.has(event.taskId)) options.set(event.taskId, event.taskTitle);
    return [...options].sort((a, b) => a[1].localeCompare(b[1], locale));
  }, [tasks, events, locale]);

  const loadMore = async () => {
    if (!nextPage || loading) return;
    setLoading(true);
    try {
      const result = await listActivity(workspaceId, nextPage, taskId || undefined);
      setEvents((current) => [...current, ...result.items]);
      setNextPage(result.nextPage);
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  };

  return <section className="activity-pane" aria-label={t('activity')}>
    <header className="activity-header"><span className="pane-heading-icon"><Activity size={23} /></span><div><h1>{t('activity')}</h1><p>{t('activityDescription')}</p></div></header>
    <div className="activity-filter"><ListFilter size={17} /><label htmlFor="activity-task-filter">{t('activityFilterTask')}</label><select id="activity-task-filter" value={taskId} onChange={(event) => { setTaskId(event.target.value); setEvents([]); setNextPage(null); setLoading(true); }}><option value="">{t('activityAllTasks')}</option>{taskOptions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select><button type="button" className="icon-button" title={t('retry')} aria-label={t('retry')} onClick={() => { setLoading(true); setReloadToken((value) => value + 1); }}><RotateCcw size={16} /></button></div>
    {error && <div className="activity-message" role="alert">{t('activityLoadFailed')} <button type="button" onClick={() => { setLoading(true); setReloadToken((value) => value + 1); }}>{t('retry')}</button></div>}
    {loading && events.length === 0 && <p className="activity-message" role="status">{t('loading')}</p>}
    {!loading && !error && events.length === 0 && <p className="activity-message">{t('activityEmpty')}</p>}
    <ol className="activity-list">{events.map((event) => <li key={event.id} className="activity-row"><span className="activity-marker" aria-hidden="true" /><div className="activity-content"><div className="activity-primary"><strong>{event.actorName}</strong><span>{t(actionKeys[event.action])}</span><button type="button" className="activity-task-link" onClick={() => { setTaskId(event.taskId); setEvents([]); setNextPage(null); setLoading(true); }} title={t('activityFilterTask')}>{event.taskTitle}</button></div>{event.action === 'task_status_changed' && event.fromStatus && event.toStatus && <div className="activity-status"><span>{t(statusKeys[event.fromStatus as keyof typeof statusKeys])}</span><ArrowRight size={14} /><span>{t(statusKeys[event.toStatus as keyof typeof statusKeys])}</span></div>}</div><time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')}>{new Date(event.createdAt).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}</time></li>)}</ol>
    {nextPage !== null && <button type="button" className="activity-more" disabled={loading} onClick={() => void loadMore()}>{loading ? t('loading') : t('activityLoadMore')}</button>}
  </section>;
}
