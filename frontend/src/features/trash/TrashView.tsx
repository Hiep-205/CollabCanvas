import { RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { usePreferences } from '../../app/Preferences';
import { changeNoteTrash, changeTaskTrash, listTrash } from './api';
import type { TrashPage } from './api';

type Props = { workspaceId: string; canEdit: boolean; onRestored: () => Promise<void> };

export default function TrashView({ workspaceId, canEdit, onRestored }: Props) {
  const { t, locale } = usePreferences();
  const [type, setType] = useState<'tasks' | 'notes'>('tasks');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<TrashPage | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setError(false);
    try { setResult(await listTrash(workspaceId, type, page)); }
    catch { setError(true); }
  }, [workspaceId, type, page]);

  useEffect(() => { queueMicrotask(() => { void reload(); }); }, [reload]);

  const restore = async (item: TrashPage['items'][number]) => {
    if (!result || busyId) return;
    setBusyId(item.id);
    setError(false);
    try {
      if (item.type === 'task') await changeTaskTrash(workspaceId, item.id, item.version, false);
      else await changeNoteTrash(workspaceId, item.id, result.canvasVersion, false);
      await onRestored();
      await reload();
    } catch { await reload(); setError(true); }
    finally { setBusyId(null); }
  };

  return <section className="trash-pane" aria-label={t('trash')}>
    <header className="trash-header"><span className="pane-heading-icon"><Trash2 size={21} /></span><div><h1>{t('trash')}</h1><p>{t('trashInfo')}</p></div></header>
    <div className="trash-tabs" role="tablist" aria-label={t('trash')}>
      {(['tasks', 'notes'] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={type === value} className={type === value ? 'active' : ''} onClick={() => { setType(value); setPage(1); setResult(null); }}>{t(value === 'tasks' ? 'trashTasks' : 'trashNotes')}</button>)}
    </div>
    {error && <p className="task-message" role="alert">{t('trashFailed')} <button type="button" onClick={() => void reload()}>{t('retry')}</button></p>}
    {!result && !error && <p className="task-message" role="status">{t('loading')}</p>}
    {result?.items.length === 0 && <p className="trash-empty">{t('trashEmpty')}</p>}
    <ul className="trash-list">{result?.items.map((item) => <li key={item.id}>
      <span className="trash-item-icon">{item.type === 'task' ? <Trash2 size={16} /> : <RotateCcw size={16} />}</span>
      <div className="trash-item-copy"><strong>{item.type === 'task' ? item.title : item.text?.trim() || t('note')}</strong><small>{new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.deletedAt))}</small>{item.type === 'note' && item.parentTaskDeleted && <small>{t('restoreParentFirst')}</small>}</div>
      {canEdit && <button className="secondary-action" type="button" title={t('restore')} disabled={!!busyId || item.type === 'note' && item.parentTaskDeleted} onClick={() => void restore(item)}><RotateCcw size={16} />{t('restore')}</button>}
    </li>)}</ul>
    {result && (page > 1 || result.nextPage !== null) && <div className="trash-pagination"><button type="button" disabled={page === 1} onClick={() => { setPage(page - 1); setResult(null); }}>←</button><span>{page}</span><button type="button" disabled={result.nextPage === null} onClick={() => { setPage(page + 1); setResult(null); }}>→</button></div>}
  </section>;
}
