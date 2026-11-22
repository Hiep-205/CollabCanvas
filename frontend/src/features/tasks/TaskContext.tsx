import { createContext } from 'react';
import type { Task } from './model';

export const TaskContext = createContext<{ tasks: Task[]; blockedBy: Map<string, Task[]>; now: number }>({ tasks: [], blockedBy: new Map(), now: Date.now() });
