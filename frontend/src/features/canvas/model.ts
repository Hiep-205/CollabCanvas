import type { Edge, Node } from '@xyflow/react';
import type { Task } from '../tasks/model';

export type NoteColor = 'yellow' | 'green' | 'pink';
export type StickyNode = Node<{ text: string; color: NoteColor; taskId?: string | null }, 'sticky'>;
export type TaskCardNode = Node<{ taskId: string }, 'task'>;
export type CanvasNode = StickyNode | TaskCardNode;
export type CanvasEdge = Edge<{ kind?: 'association' | 'dependency' }>;
export type SavedState = { version: 1; nodes: CanvasNode[]; edges: CanvasEdge[]; tasks: Task[] };
