import "server-only";

import { listTasks, getTask, listProjects } from "./tasks/queries";
import { createTask, updateTask } from "./tasks/mutations";

export { parseTaskNumber } from "./tasks/records";
export { listTasks, getTask, listProjects, createTask, updateTask };

export const TASK_TOOLS = [listTasks, getTask, listProjects, createTask, updateTask];
