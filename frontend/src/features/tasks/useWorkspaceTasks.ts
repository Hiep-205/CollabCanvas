import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../app/api';
import { addChecklistItem, createTask, getTask, listAllTasks, removeChecklistItem, toApiStatus, updateAssignees, updateChecklistItem, updateTask } from './api';
import type { ServerTask } from './api';
import type { TaskStatus } from './model';

export function useWorkspaceTasks(workspaceId: string) {
  const [tasks, setTasks] = useState<ServerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'load' | 'save' | 'conflict' | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const tasksRef = useRef(tasks);
  const busyRef = useRef(false);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const reload = useCallback(async () => {
    setLoading(true);
    try { const latest = await listAllTasks(workspaceId); tasksRef.current = latest; setTasks(latest); setError(null); }
    catch { setError('load'); }
    finally { setLoading(false); }
  }, [workspaceId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void reload();
    });
    return () => { active = false; };
  }, [reload]);

  const create = useCallback(async (status: TaskStatus, title: string) => {
    if (busyRef.current) return null;
    busyRef.current = true; setSavingId('new'); setError(null);
    try {
      const task = await createTask(workspaceId, title, status);
      tasksRef.current = [...tasksRef.current, task];
      setTasks((current) => [...current, task]);
      return task;
    } catch { setError('save'); return null; }
    finally { busyRef.current = false; setSavingId(null); }
  }, [workspaceId]);

  const change = useCallback(async (id: string, patch: Partial<Pick<ServerTask, 'title' | 'status' | 'priority' | 'dueAt' | 'description' | 'blockedReason'>>) => {
    if (busyRef.current) return false;
    const current = tasksRef.current.find((task) => task.id === id);
    if (!current) return false;
    busyRef.current = true; setSavingId(id); setError(null);
    try {
      const updated = await updateTask(workspaceId, current, patch);
      tasksRef.current = tasksRef.current.map((task) => task.id === id ? updated : task);
      setTasks((items) => items.map((task) => task.id === id ? updated : task));
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        try {
          const latest = await getTask(workspaceId, id);
          tasksRef.current = tasksRef.current.map((task) => task.id === id ? latest : task);
          setTasks((items) => items.map((task) => task.id === id ? latest : task));
        } catch { /* Keep the draft visible in the editor for manual retry. */ }
        setError('conflict');
      } else setError('save');
      return false;
    } finally { busyRef.current = false; setSavingId(null); }
  }, [workspaceId]);

  const move = useCallback((id: string, status: TaskStatus) => change(id, { status: toApiStatus(status) }), [change]);
  const assign = useCallback(async (id: string, userIds: string[]) => {
    if (busyRef.current) return false;
    const current = tasksRef.current.find((task) => task.id === id);
    if (!current) return false;
    busyRef.current = true; setSavingId(id); setError(null);
    try {
      const updated = await updateAssignees(workspaceId, current, userIds);
      tasksRef.current = tasksRef.current.map((task) => task.id === id ? updated : task);
      setTasks((items) => items.map((task) => task.id === id ? updated : task));
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) { await reload(); setError('conflict'); }
      else setError('save');
      return false;
    } finally { busyRef.current = false; setSavingId(null); }
  }, [workspaceId, reload]);
  const checklist = useCallback(async (id: string, action: { type: 'add'; title: string } | { type: 'update'; itemId: string; changes: { title?: string; isDone?: boolean } } | { type: 'remove'; itemId: string }) => {
    if (busyRef.current) return false;
    const current = tasksRef.current.find((task) => task.id === id);
    if (!current) return false;
    busyRef.current = true; setSavingId(id); setError(null);
    try {
      const updated = action.type === 'add' ? await addChecklistItem(workspaceId, current, action.title)
        : action.type === 'update' ? await updateChecklistItem(workspaceId, current, action.itemId, action.changes)
          : await removeChecklistItem(workspaceId, current, action.itemId);
      setTasks((items) => items.map((task) => task.id === id ? updated : task));
      tasksRef.current = tasksRef.current.map((task) => task.id === id ? updated : task);
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) { await reload(); setError('conflict'); }
      else setError('save');
      return false;
    } finally { busyRef.current = false; setSavingId(null); }
  }, [workspaceId, reload]);
  return { tasks, loading, error, savingId, reload, create, change, move, assign, checklist, clearError: () => setError(null) };
}
