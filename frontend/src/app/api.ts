export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options?.method && options.method !== 'GET' ? { Origin: window.location.origin } : {}),
        ...options?.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'Network error');
  }
  if (!response.ok) throw new ApiError(response.status, `HTTP ${response.status}`);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export type Workspace = {
  id: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type User = {
  id: string;
  email: string;
  displayName: string;
};

export type WorkspaceInvitation = {
  id: string;
  workspaceId: string;
  workspaceName?: string;
  role: string;
  status: string;
  createdAt: string;
  expiresAt: string;
};

export async function listWorkspaces(): Promise<Workspace[]> {
  const items: Workspace[] = [];
  for (let page = 1; page <= 1000; page += 1) {
    const result = await api<{ items: Workspace[]; nextPage: number | null }>(`/workspaces?page=${page}`);
    items.push(...result.items);
    if (result.nextPage == null) return items;
  }
  throw new Error('Too many workspace pages');
}

export type DashboardOverview = {
  summary: { workspaceCount: number; taskCount: number; completedCount: number; myOpenCount: number; myOverdueCount: number };
  tasks: { id: string; title: string; workspaceId: string; workspaceName: string; status: string; priority: string; dueAt: string | null }[];
  page: number;
  nextPage: number | null;
  asOf: string;
};
