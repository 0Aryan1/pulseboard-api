import { sendError, sendSuccess } from "../utils/response.js";
import { createTaskSchema, updateTaskSchema } from "../schemas/task.schema.js";
import { formatValidationErrors } from "../utils/validation.js";
import {
  getProjectTasks,
  getProjectTasksById,
  createProjectTasks,
  updateProjectTasks,
  deleteProjectTasks,
} from "../data/tasks.data.js";
import { emitToProject } from "../socket.js";

function sendTaskNotFound(res) {
  return sendError(
    res,
    404,
    "NOT_FOUND",
    "Task not found",
    formatValidationErrors([
      {
        path: ["taskId"],
        message: "Task with the specified ID does not exist",
      },
    ]),
  );
}

// Creators and Admins manage a task; other members may only move its status.
function canManageTask(req, task) {
  return task.created_by === req.user.id || req.projectRole === "Admin";
}

function changesTaskDetails(task, data) {
  return (
    data.title !== task.title ||
    (data.description !== undefined &&
      data.description !== (task.description ?? ""))
  );
}

export const getProjectTasksController = async (req, res) => {
  const projectId = Number(req.params.projectId);

  if (!Number.isInteger(projectId) || projectId <= 0) {
    return sendError(res, 400, "VALIDATION_ERROR", "Invalid project ID", []);
  }

  const tasks = await getProjectTasks(projectId);

  return sendSuccess(res, 200, tasks);
};

export const getProjectTasksByIdController = async (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);

  if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    !Number.isInteger(taskId) ||
    taskId <= 0
  ) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid project or task ID",
      [],
    );
  }

  const tasks = await getProjectTasksById(projectId, taskId);

  if (!tasks) {
    return sendTaskNotFound(res);
  }

  return sendSuccess(res, 200, tasks);
};

export const createProjectTaskController = async (req, res) => {
  const projectId = Number(req.params.projectId);

  if (!Number.isInteger(projectId) || projectId <= 0) {
    return sendError(res, 400, "VALIDATION_ERROR", "Invalid project ID", []);
  }

  const result = createTaskSchema.safeParse(req.body);

  if (!result.success) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid task data",
      formatValidationErrors(result.error.issues),
    );
  }

  const task = await createProjectTasks(projectId, result.data, req.user.id);

  emitToProject(projectId, "taskCreated", task);

  return sendSuccess(res, 201, task);
};

export const updateProjectTaskController = async (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);

  if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    !Number.isInteger(taskId) ||
    taskId <= 0
  ) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid project or task ID",
      [],
    );
  }

  const result = updateTaskSchema.safeParse(req.body);

  if (!result.success) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid task data",
      formatValidationErrors(result.error.issues),
    );
  }

  const task = await getProjectTasksById(projectId, taskId);

  if (!task) {
    return sendTaskNotFound(res);
  }

  let changes = result.data;

  if (!canManageTask(req, task)) {
    if (changesTaskDetails(task, result.data)) {
      return sendError(
        res,
        403,
        "FORBIDDEN",
        "Only the task's creator or an Admin can edit its title or description",
      );
    }

    changes = { status: result.data.status };
  }

  const updatedTask = await updateProjectTasks(projectId, taskId, changes);

  if (!updatedTask) {
    return sendTaskNotFound(res);
  }

  emitToProject(projectId, "taskUpdated", updatedTask);

  return sendSuccess(res, 200, updatedTask);
};

export const deleteProjectTaskController = async (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);

  if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    !Number.isInteger(taskId) ||
    taskId <= 0
  ) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid project or task ID",
      [],
    );
  }

  const task = await getProjectTasksById(projectId, taskId);

  if (!task) {
    return sendTaskNotFound(res);
  }

  if (!canManageTask(req, task)) {
    return sendError(
      res,
      403,
      "FORBIDDEN",
      "Only the task's creator or an Admin can delete it",
    );
  }

  const deletedTask = await deleteProjectTasks(projectId, taskId);

  if (!deletedTask) {
    return sendTaskNotFound(res);
  }

  emitToProject(projectId, "taskDeleted", deletedTask);

  return sendSuccess(res, 200, deletedTask);
};
