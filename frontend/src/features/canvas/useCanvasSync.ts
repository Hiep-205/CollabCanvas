import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ApiError } from '../../app/api';
import { fromSnapshot, getCanvas, saveCanvas, toSnapshot } from './api';
import type { CanvasEdge, CanvasNode } from './model';

type Setter<T> = Dispatch<SetStateAction<T>>;
type CanvasError = 'load' | 'save' | 'network' | 'conflict' | null;

export function useCanvasSync(workspaceId: string, userId: string, nodes: CanvasNode[], edges: CanvasEdge[], setNodes: Setter<CanvasNode[]>, setEdges: Setter<CanvasEdge[]>, canEdit: boolean) {
  const [version, setVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saving');
  const [error, setError] = useState<CanvasError>(null);
  const savedRef = useRef('');
  const latestRef = useRef('');
  const busyRef = useRef(false);
  const loadRequestRef = useRef(0);
  const foregroundLoadRef = useRef(false);
  const draftKey = `collabcanvas.canvas-draft.${userId}.${workspaceId}`;

  useLayoutEffect(() => {
    latestRef.current = JSON.stringify(toSnapshot('0', nodes, edges));
  }, [nodes, edges]);

  const load = useCallback(async (mode: 'restore' | 'discard' | 'refresh') => {
    const background = mode === 'refresh';
    const hasLocalChanges = () => canEdit && (busyRef.current || latestRef.current !== savedRef.current);
    if (background && (foregroundLoadRef.current || hasLocalChanges())) return;
    const savedAtStart = savedRef.current;
    const request = ++loadRequestRef.current;
    if (!background) {
      foregroundLoadRef.current = true;
      setLoading(true);
    }
    try {
      const snapshot = await getCanvas(workspaceId);
      if (request !== loadRequestRef.current) return;
      if (background && (hasLocalChanges() || savedRef.current !== savedAtStart)) return;
      const current = fromSnapshot(snapshot);
      const base = JSON.stringify(toSnapshot('0', current.nodes, current.edges));
      savedRef.current = base;
      let restored = current;
      let restoredVersion = snapshot.version;
      let conflict = false;
      if (mode === 'discard') window.sessionStorage.removeItem(draftKey);
      if (mode === 'restore' && canEdit) {
        const raw = window.sessionStorage.getItem(draftKey);
        if (raw) {
          try {
            const draft = JSON.parse(raw) as { version: string; nodes: CanvasNode[]; edges: CanvasEdge[] };
            if (typeof draft.version === 'string' && Array.isArray(draft.nodes) && Array.isArray(draft.edges)) {
              restored = draft;
              restoredVersion = draft.version;
              conflict = draft.version !== snapshot.version;
            } else window.sessionStorage.removeItem(draftKey);
          } catch { window.sessionStorage.removeItem(draftKey); }
        }
      }
      setNodes(restored.nodes);
      setEdges(restored.edges);
      setVersion(restoredVersion);
      setError(conflict ? 'conflict' : null);
      setState(conflict ? 'error' : restored === current ? 'saved' : 'saving');
    } catch {
      if (!background && request === loadRequestRef.current) {
        setError('load');
        setState('error');
      }
    } finally {
      if (!background && request === loadRequestRef.current) {
        foregroundLoadRef.current = false;
        setLoading(false);
      }
    }
  }, [workspaceId, draftKey, setNodes, setEdges, canEdit]);

  const reload = useCallback((discardDraft = false) => load(discardDraft ? 'discard' : 'restore'), [load]);
  const refresh = useCallback(() => load('refresh'), [load]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void reload(); });
    return () => {
      active = false;
      loadRequestRef.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    const retryAfterReconnect = () => {
      setError((current) => current === 'network' ? null : current);
    };
    window.addEventListener('online', retryAfterReconnect);
    return () => window.removeEventListener('online', retryAfterReconnect);
  }, []);

  useEffect(() => {
    if (!version || loading) return;
    const serialized = latestRef.current;
    if (serialized === savedRef.current) {
      if (!error && !busyRef.current) {
        window.sessionStorage.removeItem(draftKey);
        const timer = window.setTimeout(() => setState('saved'), 0);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    if (!canEdit) return;
    window.sessionStorage.setItem(draftKey, JSON.stringify({ version, nodes, edges }));
    if (error || busyRef.current) return;
    const stateTimer = window.setTimeout(() => setState('saving'), 0);
    const timer = window.setTimeout(async () => {
      busyRef.current = true;
      try {
        const result = await saveCanvas(workspaceId, toSnapshot(version, nodes, edges));
        savedRef.current = serialized;
        setVersion(result.version);
        if (latestRef.current === serialized) window.sessionStorage.removeItem(draftKey);
        setError(null);
        setState('saved');
      } catch (cause) {
        const status = cause instanceof ApiError ? cause.status : undefined;
        if (status === 409) setError('conflict');
        else if (status === 0) setError('network');
        else setError('save');
        setState('error');
      } finally { busyRef.current = false; }
    }, 650);
    return () => { window.clearTimeout(stateTimer); window.clearTimeout(timer); };
  }, [workspaceId, draftKey, nodes, edges, version, loading, canEdit, error]);

  return { loading, state, error, version, retry: () => setError(null), reload, refresh };
}
