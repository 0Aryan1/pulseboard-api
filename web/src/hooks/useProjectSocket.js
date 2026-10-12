import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { selectCurrentUserId, selectToken } from "../features/auth/authSlice.js";
import { logRequest } from "../features/devtools/devLogSlice.js";
import { api } from "../services/api.js";
import { getSocket } from "../services/socket.js";
import { useToast } from "./useToast.js";

const taskTags = (projectId) => (task) =>
  // Task payloads carry project_id, so ignore anything for another project.
  Number(task?.project_id) === projectId
    ? [
        { type: "Task", id: `PROJECT-${projectId}` },
        // Also refresh a single-task query for this id, if one is cached.
        { type: "Task", id: task.id },
      ]
    : [];

// Comment payloads carry task_id but no project_id; they are only ever
// delivered to this project's room, which already scopes them.
const commentTags = (comment) =>
  comment?.task_id ? [{ type: "Comment", id: `TASK-${comment.task_id}` }] : [];

// Same scoping as comments: task_id only, delivered to this project's room.
const attachmentTags = (attachment) =>
  attachment?.task_id
    ? [{ type: "Attachment", id: `TASK-${attachment.task_id}` }]
    : [];

// Member payloads are project_members rows, which carry project_id. Refetching
// the member list also refreshes the caller's own role (useProjectRole).
const memberTags = (projectId) => (member) =>
  Number(member?.project_id) === projectId
    ? [{ type: "Member", id: `PROJECT-${projectId}` }]
    : [];

// Rename and ownership transfer send the full project row. The projects list
// is refreshed by useUserSocket, which hears these on every page.
const projectTags = (projectId) => (project) =>
  Number(project?.id) === projectId ? [{ type: "Project", id: projectId }] : [];

// A teammate renamed or deleted their account: refresh everything that shows
// author names (members, the task board, and the open task's comments).
const userTags = (projectId) => () => [
  { type: "Member", id: `PROJECT-${projectId}` },
  { type: "Task", id: `PROJECT-${projectId}` },
  { type: "Comment" },
];

/**
 * Server events (src/controllers/*.controller.js) mapped to the RTK Query
 * cache tags they make stale. Payloads are raw rows without the author's
 * name, so affected lists are refetched rather than patched in place.
 *
 * Comment and attachment lists are only cached while their task drawer is
 * open, so events for other tasks invalidate nothing and cost no requests.
 */
const eventTags = (projectId) => ({
  taskCreated: taskTags(projectId),
  taskUpdated: taskTags(projectId),
  taskDeleted: taskTags(projectId),
  commentCreated: commentTags,
  commentUpdated: commentTags,
  commentDeleted: commentTags,
  attachmentCreated: attachmentTags,
  attachmentDeleted: attachmentTags,
  // Processing outcomes from the upload worker, relayed by src/uploadEvents.js.
  attachmentReady: attachmentTags,
  attachmentFailed: attachmentTags,
  memberAdded: memberTags(projectId),
  memberUpdated: memberTags(projectId),
  memberRemoved: memberTags(projectId),
  projectUpdated: projectTags(projectId),
  userUpdated: userTags(projectId),
  userDeleted: userTags(projectId),
});

/**
 * Keeps a project live: joins its Socket.IO room and refetches tasks and the
 * open task's comments and attachments when any member changes them.
 */
export function useProjectSocket(projectId) {
  const dispatch = useDispatch();
  const token = useSelector(selectToken);
  const currentUserId = useSelector(selectCurrentUserId);
  const navigate = useNavigate();
  // Only the memoised callback goes in the effect's deps: useToast returns a
  // new object every render, which would rejoin the room on each render.
  const { error: showError } = useToast();

  useEffect(() => {
    if (!token || !projectId) return undefined;

    const socket = getSocket(token);

    const log = (event, payload, ok = true) =>
      dispatch(
        logRequest({
          method: "WS",
          url: event,
          status: ok ? "event" : "error",
          ok,
          durationMs: 0,
          response: payload,
        })
      );

    // Rooms are not kept across reconnects, so join on every connect rather
    // than once.
    const onConnect = () => socket.emit("joinProject", projectId);

    // One handler per event so each is logged under its own name and can be
    // detached precisely on cleanup.
    const handlers = Object.entries(eventTags(projectId)).map(([event, tagsFor]) => [
      event,
      (payload) => {
        log(event, payload);

        const tags = tagsFor(payload);
        if (tags.length) dispatch(api.util.invalidateTags(tags));
      },
    ]);

    // The server has already taken this tab out of the room; leave the page
    // too, since every request for this project now answers 403.
    const onRemovedFromProject = (payload) => {
      if (Number(payload?.projectId) !== projectId) return;

      log("removedFromProject", payload, false);
      showError("You were removed from this project.");
      navigate("/projects", { replace: true });
    };

    // The server empties the room after this event. Whoever deleted the
    // project already saw a success toast, so only tell everyone else.
    const onProjectDeleted = (payload) => {
      if (Number(payload?.projectId) !== projectId) return;

      log("projectDeleted", payload);

      if (payload.deletedBy !== currentUserId) {
        showError("This project was deleted.");
      }

      navigate("/projects", { replace: true });
    };

    const onProjectError = (message) => log("projectError", message, false);
    const onConnectError = (error) => log("connect_error", error.message, false);

    socket.on("connect", onConnect);
    handlers.forEach(([event, handler]) => socket.on(event, handler));
    socket.on("removedFromProject", onRemovedFromProject);
    socket.on("projectDeleted", onProjectDeleted);
    socket.on("projectError", onProjectError);
    socket.on("connect_error", onConnectError);

    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    return () => {
      socket.emit("leaveProject", projectId);
      socket.off("connect", onConnect);
      handlers.forEach(([event, handler]) => socket.off(event, handler));
      socket.off("removedFromProject", onRemovedFromProject);
      socket.off("projectDeleted", onProjectDeleted);
      socket.off("projectError", onProjectError);
      socket.off("connect_error", onConnectError);
    };
  }, [dispatch, token, projectId, currentUserId, navigate, showError]);
}
