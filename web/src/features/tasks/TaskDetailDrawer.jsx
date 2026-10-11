import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSelector } from "react-redux";
import { Button } from "../../components/ui/Button.jsx";
import { StatusBadge } from "../../components/ui/Badge.jsx";
import { Avatar } from "../../components/ui/Avatar.jsx";
import { Select } from "../../components/ui/Field.jsx";
import { ConfirmDialog } from "../../components/ui/Modal.jsx";
import { TaskFormModal } from "./TaskFormModal.jsx";
import { CommentThread } from "../comments/CommentThread.jsx";
import { AttachmentPanel } from "../attachments/AttachmentPanel.jsx";
import { useToast } from "../../hooks/useToast.js";
import { useProjectRole } from "../../hooks/useProjectRole.js";
import { selectCurrentUserId } from "../auth/authSlice.js";
import { TASK_STATUS_LIST } from "../../lib/constants.js";
import { formatDateTime } from "../../lib/format.js";
import {
  useDeleteTaskMutation,
  useUpdateTaskMutation,
} from "../../services/endpoints/tasks.api.js";

function Section({ title, children }) {
  return (
    <section className="border-t border-line px-5 py-4">
      <h3 className="mb-3 text-xs font-semibold text-ink-muted uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function TaskDetailDrawer({ task, projectId, onClose }) {
  const toast = useToast();
  const currentUserId = useSelector(selectCurrentUserId);
  const { isAdmin } = useProjectRole(projectId);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [updateTask, { isLoading: isUpdating }] = useUpdateTaskMutation();
  const [deleteTask, { isLoading: isDeleting }] = useDeleteTaskMutation();

  useEffect(() => {
    if (!task) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [task, onClose]);

  if (!task) return null;

  // Mirrors the API: anyone can move a task, but only its creator or an
  // Admin can edit its details or delete it.
  const canManage = isAdmin || task.created_by === currentUserId;

  // updateTaskSchema requires title and status on every call, so a status
  // change resends the whole task rather than patching one field.
  const onStatusChange = async (event) => {
    try {
      await updateTask({
        projectId,
        taskId: task.id,
        title: task.title,
        description: task.description ?? "",
        status: event.target.value,
      }).unwrap();
    } catch (error) {
      toast.error(error, "Could not change the status.");
    }
  };

  const onDelete = async () => {
    try {
      await deleteTask({ projectId, taskId: task.id }).unwrap();
      setConfirmOpen(false);
      onClose();
      toast.success("Task deleted.");
    } catch (error) {
      toast.error(error, "Could not delete the task.");
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="absolute inset-0 bg-ink/20"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        className="scrollbar-slim relative flex w-full max-w-md flex-col overflow-y-auto border-l border-line bg-surface shadow-2xl shadow-ink/10"
      >
        <header className="sticky top-0 z-10 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-ink-subtle">
                  #{task.id}
                </span>
                <StatusBadge status={task.status} />
              </div>
              <h2 className="mt-1.5 text-base leading-snug break-words">
                {task.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md px-2 py-1 text-ink-subtle transition-colors hover:bg-zinc-100 hover:text-ink"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {canManage && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmOpen(true)}>
                Delete
              </Button>
            </div>
          )}
        </header>

        <Section title="Status">
          <Select value={task.status} onChange={onStatusChange} disabled={isUpdating}>
            {TASK_STATUS_LIST.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </Section>

        <Section title="Description">
          <p className="text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
            {task.description || "No description."}
          </p>
        </Section>

        <Section title="Created by">
          <div className="flex items-center gap-2.5">
            <Avatar name={task.created_by_name} size="md" />
            <div>
              <p className="text-xs font-medium">
                {task.created_by_name ?? "Unknown"}
              </p>
              <p className="text-[11px] text-ink-subtle">
                {task.created_by_email ?? ""} · {formatDateTime(task.created_at)}
              </p>
            </div>
          </div>
        </Section>

        <Section title="Attachments">
          <AttachmentPanel taskId={task.id} projectId={projectId} />
        </Section>

        <Section title="Comments">
          <CommentThread taskId={task.id} projectId={projectId} />
        </Section>
      </aside>

      <TaskFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        projectId={projectId}
        task={task}
      />

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={onDelete}
        loading={isDeleting}
        title="Delete this task?"
        description="Its comments and attachments are removed too."
      />
    </div>,
    document.body
  );
}
