import { api } from '../../app/api';
import type { CanvasEdge, CanvasNode } from './model';
import { relationKind } from './relationships';

type ApiNode = { id: string; type: 'task' | 'note'; taskId: string | null; text: string | null; color: 'yellow' | 'green' | 'pink' | null; x: number; y: number; hidden: boolean };
type ApiEdge = { source: string; target: string; kind: 'association' | 'dependency' };
export type CanvasSnapshot = { version: string; nodes: ApiNode[]; edges: ApiEdge[] };

export function fromSnapshot(snapshot: CanvasSnapshot): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return {
    nodes: snapshot.nodes.map((node) => node.type === 'task'
      ? { id: node.id, type: 'task', position: { x: node.x, y: node.y }, hidden: node.hidden, data: { taskId: node.taskId! } }
      : { id: node.id, type: 'sticky', position: { x: node.x, y: node.y }, data: { text: node.text!, color: node.color!, taskId: node.taskId } }),
    edges: snapshot.edges.map((edge) => ({ id: `${edge.kind}:${edge.source}:${edge.target}`, source: edge.source, target: edge.target, type: 'smoothstep', data: { kind: edge.kind } })),
  };
}

export function toSnapshot(version: string, nodes: CanvasNode[], edges: CanvasEdge[]): CanvasSnapshot {
  return {
    version,
    nodes: nodes.map((node) => node.type === 'task'
      ? { id: node.id, type: 'task', taskId: node.data.taskId, text: null, color: null, x: node.position.x, y: node.position.y, hidden: !!node.hidden }
      : { id: node.id, type: 'note', taskId: node.data.taskId ?? null, text: node.data.text, color: node.data.color, x: node.position.x, y: node.position.y, hidden: false }),
    edges: edges.map((edge) => ({ source: edge.source, target: edge.target, kind: relationKind(edge, nodes) })),
  };
}

export const getCanvas = (workspaceId: string) => api<CanvasSnapshot>(`/workspaces/${workspaceId}/canvas`);
export const saveCanvas = (workspaceId: string, snapshot: CanvasSnapshot) => api<CanvasSnapshot>(`/workspaces/${workspaceId}/canvas`, { method: 'PUT', body: JSON.stringify(snapshot) });
