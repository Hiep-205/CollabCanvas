import { createContext } from 'react';
import type { Task } from './model';

export const TaskContext = createContext<Task[]>([]);
