import type { SavedState } from './model';

export const STORAGE_KEY = 'collabcanvas.prototype.v1';

const initialState: SavedState = {
  version: 1,
  tasks: [
    { id: 'task-research', title: 'Khảo sát ứng dụng tương tự', status: 'TODO' },
    { id: 'task-flow', title: 'Thiết kế luồng công việc', status: 'TODO' },
    { id: 'task-demo', title: 'Chuẩn bị nội dung báo cáo', status: 'IN_PROGRESS' },
    { id: 'task-interface', title: 'Phác thảo giao diện Kanban', status: 'IN_PROGRESS' },
    { id: 'task-scope', title: 'Chốt phạm vi MVP', status: 'DONE' },
  ],
  nodes: [
    { id: 'note-green-demo', type: 'sticky', position: { x: 60, y: 50 }, data: { text: 'Tổng hợp ý tưởng\nChọn các đầu việc quan trọng.', color: 'green' } },
    { id: 'note-demo', type: 'sticky', position: { x: 340, y: 50 }, data: { text: 'Ý tưởng đầu tiên\nChia nhỏ công việc thành từng bước.', color: 'yellow' } },
    { id: 'task-node-interface', type: 'task', position: { x: 60, y: 290 }, data: { taskId: 'task-interface' } },
    { id: 'task-node-demo', type: 'task', position: { x: 340, y: 290 }, data: { taskId: 'task-demo' } },
    { id: 'note-pink-demo', type: 'sticky', position: { x: 200, y: 530 }, data: { text: 'Rà soát bản demo\nKiểm tra luồng thao tác trước báo cáo.', color: 'pink' } },
  ],
  edges: [
    { id: 'edge-idea-interface', source: 'note-green-demo', target: 'task-node-interface', type: 'smoothstep' },
    { id: 'edge-idea-report', source: 'note-demo', target: 'task-node-demo', type: 'smoothstep' },
    { id: 'edge-interface-review', source: 'task-node-interface', target: 'note-pink-demo', type: 'smoothstep' },
    { id: 'edge-report-review', source: 'task-node-demo', target: 'note-pink-demo', type: 'smoothstep' },
  ],
};

export function loadState(): SavedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed && parsed.version === 1 &&
      'nodes' in parsed && Array.isArray(parsed.nodes) && 'edges' in parsed && Array.isArray(parsed.edges) &&
      'tasks' in parsed && Array.isArray(parsed.tasks)) {
      return parsed as SavedState;
    }
  } catch {
    // A broken browser record should not prevent the canvas from opening.
  }
  return initialState;
}
