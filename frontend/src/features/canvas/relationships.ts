import type { Task } from '../tasks/model';
import type { CanvasEdge, CanvasNode, TaskCardNode } from './model';

export function relationKind(edge: Pick<CanvasEdge, 'source' | 'target'>, nodes: CanvasNode[]) {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  return source?.type === 'task' && target?.type === 'task' ? 'dependency' : 'association';
}

export function taskBlockers(tasks: Task[], nodes: CanvasNode[], edges: CanvasEdge[]) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const blockedBy = new Map<string, Task[]>();

  for (const edge of edges) {
    if (relationKind(edge, nodes) !== 'dependency') continue;
    const source = nodeById.get(edge.source) as TaskCardNode | undefined;
    const target = nodeById.get(edge.target) as TaskCardNode | undefined;
    const prerequisite = taskById.get(source?.data.taskId ?? '');
    if (!prerequisite || prerequisite.status === 'DONE' || !target) continue;
    const blockers = blockedBy.get(target.data.taskId) ?? [];
    if (!blockers.some((task) => task.id === prerequisite.id)) blockers.push(prerequisite);
    blockedBy.set(target.data.taskId, blockers);
  }
  return blockedBy;
}

export function wouldCreateDependencyCycle(source: string, target: string, nodes: CanvasNode[], edges: CanvasEdge[]) {
  const stack = [target];
  const visited = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges) {
      if (edge.source === current && relationKind(edge, nodes) === 'dependency') stack.push(edge.target);
    }
  }
  return false;
}

export function isBottleneckTask(task: Task | undefined, now = Date.now()): boolean {
  if (!task || task.status === 'DONE') return false;
  const hasManualBlock = Boolean(task.blockedReason && task.blockedReason.trim().length > 0);
  const isOverdue = Boolean(task.dueAt && new Date(task.dueAt).getTime() < now);
  return hasManualBlock || isOverdue;
}

export function isBottleneckEdge(
  edge: Pick<CanvasEdge, 'source' | 'target'>,
  nodes: CanvasNode[],
  tasks: Task[],
  now = Date.now()
): boolean {
  if (relationKind(edge, nodes) !== 'dependency') return false;
  const sourceNode = nodes.find((node) => node.id === edge.source);
  if (sourceNode?.type !== 'task') return false;
  const sourceTask = tasks.find((task) => task.id === sourceNode.data.taskId);
  return isBottleneckTask(sourceTask, now);
}
