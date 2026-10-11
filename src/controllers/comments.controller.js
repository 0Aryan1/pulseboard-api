import { sendError, sendSuccess } from "../utils/response.js";
import {
  createCommentSchema,
  updateCommentSchema,
} from "../schemas/comment.schema.js";
import { formatValidationErrors } from "../utils/validation.js";
import {
  getAllComments,
  getCommentById,
  createComment,
  updateComment,
  deleteComment,
} from "../data/comments.data.js";
import { emitToProject } from "../socket.js";

// Members manage their own comments; Admins can moderate anyone's.
function canManageComment(req, comment) {
  return comment.created_by === req.user.id || req.projectRole === "Admin";
}

function sendCommentForbidden(res) {
  return sendError(
    res,
    403,
    "FORBIDDEN",
    "You can only edit or delete your own comments",
  );
}

export const getCommentsController = async (req, res) => {
  const taskId = Number(req.params.taskId);

  if (!Number.isInteger(taskId) || taskId <= 0) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid project or task ID",
      [],
    );
  }

  const comments = await getAllComments(taskId);

  return sendSuccess(res, 200, comments);
};

export const getCommentByIdController = async (req, res) => {
  const taskId = Number(req.params.taskId);
  const commentId = Number(req.params.commentId);

  if (
    !Number.isInteger(taskId) ||
    taskId <= 0 ||
    !Number.isInteger(commentId) ||
    commentId <= 0
  ) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid project, task, or comment ID",
      [],
    );
  }

  const comment = await getCommentById(taskId, commentId);

  if (!comment) {
    return sendError(
      res,
      404,
      "NOT_FOUND",
      "Comment not found",
      formatValidationErrors([
        {
          path: ["commentId"],
          message: "Comment with the specified ID does not exist",
        },
      ]),
    );
  }

  return sendSuccess(res, 200, comment);
};

export const createCommentController = async (req, res) => {
  const taskId = Number(req.params.taskId);

  if (!Number.isInteger(taskId) || taskId <= 0) {
    return sendError(res, 400, "VALIDATION_ERROR", "Invalid task ID", []);
  }

  const result = createCommentSchema.safeParse(req.body);

  if (!result.success) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid comment data",
      formatValidationErrors(result.error.issues),
    );
  }

  const comment = await createComment(taskId, result.data, req.user.id);

  emitToProject(req.projectId, "commentCreated", comment);

  return sendSuccess(res, 201, comment);
};

export const updateCommentController = async (req, res) => {
  const commentId = Number(req.params.commentId);
  const taskId = Number(req.params.taskId);

  if (
    !Number.isInteger(taskId) ||
    taskId <= 0 ||
    !Number.isInteger(commentId) ||
    commentId <= 0
  ) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid task or comment ID",
      [],
    );
  }

  const result = updateCommentSchema.safeParse(req.body);

  if (!result.success) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid comment data",
      formatValidationErrors(result.error.issues),
    );
  }

  const comment = await getCommentById(taskId, commentId);

  if (!comment) {
    return sendError(res, 404, "NOT_FOUND", "Comment not found");
  }

  if (!canManageComment(req, comment)) {
    return sendCommentForbidden(res);
  }

  const updatedComment = await updateComment(taskId, commentId, result.data);

  if (!updatedComment) {
    return sendError(res, 404, "NOT_FOUND", "Comment not found");
  }

  emitToProject(req.projectId, "commentUpdated", updatedComment);

  return sendSuccess(res, 200, updatedComment);
};

export const deleteCommentController = async (req, res) => {
  const commentId = Number(req.params.commentId);
  const taskId = Number(req.params.taskId);

  if (
    !Number.isInteger(taskId) ||
    taskId <= 0 ||
    !Number.isInteger(commentId) ||
    commentId <= 0
  ) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid task or comment ID",
      [],
    );
  }

  const comment = await getCommentById(taskId, commentId);

  if (!comment) {
    return sendError(res, 404, "NOT_FOUND", "Comment not found");
  }

  if (!canManageComment(req, comment)) {
    return sendCommentForbidden(res);
  }

  const deletedComment = await deleteComment(taskId, commentId);

  if (!deletedComment) {
    return sendError(res, 404, "NOT_FOUND", "Comment not found");
  }

  emitToProject(req.projectId, "commentDeleted", deletedComment);

  return sendSuccess(res, 200, deletedComment);
};
