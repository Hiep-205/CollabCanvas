import type { SavedState } from './model';

export const STORAGE_KEY = 'collabcanvas.prototype.v1';

const initialState: SavedState = {
  version: 1,
  tasks: [{ id: 'task-demo', title: 'Chuẩn bị nội dung báo cáo', status: 'IN_PROGRESS' }],
  nodes: [
    { id: 'note-demo', type: 'sticky', position: { x: 120, y: 140 }, data: { text: 'Ý tưởng đầu tiên\nChia nhỏ công việc thành từng bước.', color: 'yellow' } },
    { id: 'task-node-demo', type: 'task', position: { x: 520, y: 170 }, data: { taskId: 'task-demo' } },
  ],
  edges: [],
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
