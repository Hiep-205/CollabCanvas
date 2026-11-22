import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkspaceGateway } from '../realtime/workspace.gateway';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_VERSION = 9223372036854775807n;
type NodeInput = { id: string; type: 'task' | 'note'; taskId: string | null; text: string | null; color: 'yellow' | 'green' | 'pink' | null; x: number; y: number; hidden: boolean };
type EdgeInput = { source: string; target: string; kind: 'association' | 'dependency' };
type Snapshot = { version: bigint; nodes: NodeInput[]; edges: EdgeInput[] };

function parseSnapshot(body: unknown): Snapshot {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid canvas');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['version', 'nodes', 'edges'].includes(key)) ||
    typeof input.version !== 'string' || !/^[1-9]\d*$/.test(input.version) || BigInt(input.version) > MAX_VERSION ||
    !Array.isArray(input.nodes) || input.nodes.length > 100 || !Array.isArray(input.edges) || input.edges.length > 200) {
    throw new BadRequestException('Invalid canvas snapshot');
  }
  const nodes: NodeInput[] = input.nodes.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException('Invalid node');
    const node = item as Record<string, unknown>;
    if (Object.keys(node).some((key) => !['id', 'type', 'taskId', 'text', 'color', 'x', 'y', 'hidden'].includes(key)) ||
      typeof node.id !== 'string' || !UUID.test(node.id) || !Number.isFinite(node.x) || !Number.isFinite(node.y) ||
      Math.abs(node.x as number) > 9999999999 || Math.abs(node.y as number) > 9999999999 || typeof node.hidden !== 'boolean') {
      throw new BadRequestException('Invalid node');
    }
    if (node.type === 'task' && typeof node.taskId === 'string' && UUID.test(node.taskId) && node.text === null && node.color === null) return node as NodeInput;
    if (node.type === 'note' && (node.taskId === null || typeof node.taskId === 'string' && UUID.test(node.taskId)) && typeof node.text === 'string' && node.text.length <= 10000 &&
      ['yellow', 'green', 'pink'].includes(node.color as string) && node.hidden === false) return node as NodeInput;
    throw new BadRequestException('Invalid node shape');
  });
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length || new Set(nodes.filter((node) => node.type === 'task').map((node) => node.taskId)).size !== nodes.filter((node) => node.type === 'task').length) {
    throw new BadRequestException('Duplicate node or task');
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeKeys = new Set<string>();
  const edges: EdgeInput[] = input.edges.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException('Invalid edge');
    const edge = item as Record<string, unknown>;
    if (Object.keys(edge).some((key) => !['source', 'target', 'kind'].includes(key)) || typeof edge.source !== 'string' ||
      typeof edge.target !== 'string' || edge.source === edge.target || !ids.has(edge.source) || !ids.has(edge.target)) throw new BadRequestException('Invalid edge');
    const kind = nodeById.get(edge.source)?.type === 'task' && nodeById.get(edge.target)?.type === 'task' ? 'dependency' : 'association';
    if (edge.kind !== kind) throw new BadRequestException('Invalid edge kind');
    const key = kind === 'dependency' ? `${edge.source}:${edge.target}` : [edge.source, edge.target].sort().join(':');
    if (edgeKeys.has(key)) throw new BadRequestException('Duplicate edge');
    edgeKeys.add(key);
    return edge as EdgeInput;
  });
  const dependencies = edges.filter((edge) => edge.kind === 'dependency');
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new BadRequestException('Dependency cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of dependencies) if (edge.source === id) visit(edge.target);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) if (node.type === 'task') visit(node.id);
  return { version: BigInt(input.version), nodes, edges };
}

@Injectable()
export class CanvasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceGateway: WorkspaceGateway,
  ) {}

  private async membership(userId: string, workspaceId: string, edit: boolean) {
    const member = await this.prisma.workspace_members.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } }, select: { role: true },
    });
    if (!member) throw new NotFoundException('Workspace not found');
    if (edit && member.role === 'viewer') throw new ForbiddenException('Workspace is read-only');
  }

  async get(userId: string, workspaceId: string) {
    await this.membership(userId, workspaceId, false);
    const [workspace, nodes, associations, dependencies] = await this.prisma.$transaction(async (tx) => Promise.all([
      tx.workspaces.findUnique({ where: { id: workspaceId }, select: { canvas_version: true } }),
      tx.canvas_nodes.findMany({ where: { workspace_id: workspaceId }, orderBy: { id: 'asc' }, include: { tasks: { select: { deleted_at: true } } } }),
      tx.canvas_associations.findMany({ where: { workspace_id: workspaceId } }),
      tx.task_dependencies.findMany({ where: { workspace_id: workspaceId } }),
    ]), { isolationLevel: 'RepeatableRead' });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const visibleNodes = nodes.filter((node) => !node.deleted_at && !node.tasks?.deleted_at);
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    const taskNodeById = new Map(visibleNodes.filter((node) => node.node_type === 'task').map((node) => [node.task_id, node.id]));
    return {
      version: workspace.canvas_version.toString(),
      nodes: visibleNodes.map((node) => ({ id: node.id, type: node.node_type, taskId: node.task_id, text: node.note_text, color: node.note_color,
        x: Number(node.position_x), y: Number(node.position_y), hidden: node.is_hidden })),
      edges: [
        ...associations.filter((edge) => visibleIds.has(edge.node_a_id) && visibleIds.has(edge.node_b_id))
          .map((edge) => ({ source: edge.node_a_id, target: edge.node_b_id, kind: 'association' })),
        ...dependencies.flatMap((edge) => {
          const source = taskNodeById.get(edge.prerequisite_task_id);
          const target = taskNodeById.get(edge.dependent_task_id);
          return source && target ? [{ source, target, kind: 'dependency' }] : [];
        }),
      ],
    };
  }

  async save(userId: string, workspaceId: string, body: unknown) {
    await this.membership(userId, workspaceId, true);
    const snapshot = parseSnapshot(body);
    const currentVersion = await this.prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { canvas_version: true } });
    if (!currentVersion || currentVersion.canvas_version !== snapshot.version) throw new ConflictException('Canvas has changed; reload before saving');
    const taskIds = [...new Set(snapshot.nodes.map((node) => node.taskId).filter((id): id is string => id !== null))];
    const validTasks = await this.prisma.tasks.count({ where: { workspace_id: workspaceId, deleted_at: null, id: { in: taskIds } } });
    if (validTasks !== taskIds.length) throw new BadRequestException('Task does not belong to workspace');
    const foreignNodes = await this.prisma.canvas_nodes.count({ where: { id: { in: snapshot.nodes.map((node) => node.id) }, workspace_id: { not: workspaceId } } });
    if (foreignNodes) throw new BadRequestException('Node does not belong to workspace');
    await this.prisma.$transaction(async (tx) => {
        const bumped = await tx.workspaces.updateMany({ where: { id: workspaceId, canvas_version: snapshot.version }, data: { canvas_version: { increment: 1 } } });
        if (!bumped.count) throw new ConflictException('Canvas has changed; reload before saving');
        const ids = snapshot.nodes.map((node) => node.id);
        const existing = await tx.canvas_nodes.findMany({ where: { workspace_id: workspaceId },
          select: { id: true, node_type: true, task_id: true, deleted_at: true, tasks: { select: { deleted_at: true } } } });
        const inactiveIds = new Set(existing.filter((node) => node.deleted_at || node.tasks?.deleted_at).map((node) => node.id));
        if (ids.some((id) => inactiveIds.has(id))) throw new ConflictException('Canvas contains a trashed node');
        const removed = existing.filter((node) => !inactiveIds.has(node.id) && !ids.includes(node.id));
        if (removed.some((node) => node.node_type === 'note')) throw new ConflictException('Trash notes through the trash API');
        if (removed.length && await tx.attachments.count({ where: { workspace_id: workspaceId, note_node_id: { in: removed.map((node) => node.id) } } })) {
          throw new ConflictException('Attached notes cannot be removed');
        }
        const associations = await tx.canvas_associations.findMany({ where: { workspace_id: workspaceId },
          select: { id: true, node_a_id: true, node_b_id: true } });
        const preservedAssociations = associations.filter((edge) => inactiveIds.has(edge.node_a_id) || inactiveIds.has(edge.node_b_id));
        if (removed.some((node) => preservedAssociations.some((edge) => edge.node_a_id === node.id || edge.node_b_id === node.id))) {
          throw new ConflictException('A removed node is linked to trash');
        }
        await tx.canvas_associations.deleteMany({ where: { id: { in: associations.filter((edge) => !preservedAssociations.includes(edge)).map((edge) => edge.id) } } });
        const deletedTasks = await tx.tasks.findMany({ where: { workspace_id: workspaceId, deleted_at: { not: null } }, select: { id: true } });
        const deletedTaskIds = deletedTasks.map((task) => task.id);
        const dependencies = await tx.task_dependencies.findMany({ where: { workspace_id: workspaceId },
          select: { prerequisite_task_id: true, dependent_task_id: true } });
        if (removed.some((node) => node.task_id && dependencies.some((edge) => deletedTaskIds.includes(edge.prerequisite_task_id) && edge.dependent_task_id === node.task_id ||
          deletedTaskIds.includes(edge.dependent_task_id) && edge.prerequisite_task_id === node.task_id))) {
          throw new ConflictException('A removed task is linked to trash');
        }
        await tx.task_dependencies.deleteMany({ where: { workspace_id: workspaceId,
          prerequisite_task_id: { notIn: deletedTaskIds }, dependent_task_id: { notIn: deletedTaskIds } } });
        await tx.canvas_nodes.deleteMany({ where: { workspace_id: workspaceId, id: { notIn: [...ids, ...inactiveIds] } } });
        for (const node of snapshot.nodes) {
          const data = { node_type: node.type, task_id: node.taskId, note_text: node.text, note_color: node.color,
            position_x: node.x, position_y: node.y, is_hidden: node.hidden };
          await tx.canvas_nodes.upsert({ where: { workspace_id_id: { workspace_id: workspaceId, id: node.id } }, create: { id: node.id, workspace_id: workspaceId, created_by_user_id: userId, ...data },
            update: { ...data, updated_by_user_id: userId, updated_at: new Date(), version: { increment: 1 } } });
        }
        const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
        for (const edge of snapshot.edges) {
          if (edge.kind === 'association') {
            const [node_a_id, node_b_id] = [edge.source, edge.target].sort();
            await tx.canvas_associations.create({ data: { workspace_id: workspaceId, node_a_id, node_b_id, created_by_user_id: userId } });
          } else {
            await tx.task_dependencies.create({ data: { workspace_id: workspaceId, prerequisite_task_id: nodeById.get(edge.source)!.taskId!,
              dependent_task_id: nodeById.get(edge.target)!.taskId!, created_by_user_id: userId } });
          }
        }
    });
    const result = await this.get(userId, workspaceId);
    this.workspaceGateway.broadcastCanvasBumped(workspaceId, result.version, userId);
    return result;
  }
}
