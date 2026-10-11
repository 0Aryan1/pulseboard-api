import { useState } from "react";
import { useSelector } from "react-redux";
import { Avatar } from "../../components/ui/Avatar.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Textarea } from "../../components/ui/Field.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { ConfirmDialog } from "../../components/ui/Modal.jsx";
import { useToast } from "../../hooks/useToast.js";
import { useProjectRole } from "../../hooks/useProjectRole.js";
import { selectCurrentUserId } from "../auth/authSlice.js";
import { formatRelative } from "../../lib/format.js";
import {
  useCreateCommentMutation,
  useDeleteCommentMutation,
  useGetCommentsQuery,
  useUpdateCommentMutation,
} from "../../services/endpoints/comments.api.js";

function CommentRow({ comment, taskId, canManage }) {
  const toast = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [updateComment, { isLoading: isSaving }] = useUpdateCommentMutation();
  const [deleteComment, { isLoading: isDeleting }] = useDeleteCommentMutation();

  const onSave = async () => {
    try {
      await updateComment({ taskId, commentId: comment.id, content: draft }).unwrap();
      setIsEditing(false);
    } catch (error) {
      toast.error(error, "Could not update the comment.");
    }
  };

  const onDelete = async () => {
    try {
      await deleteComment({ taskId, commentId: comment.id }).unwrap();
      setConfirmOpen(false);
    } catch (error) {
      toast.error(error, "Could not delete the comment.");
    }
  };

  return (
    <div className="flex gap-2.5">
      <Avatar name={comment.created_by_name} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium">
            {comment.created_by_name ?? "Unknown"}
          </span>
          <span className="text-[11px] text-ink-subtle">
            {formatRelative(comment.created_at)}
          </span>
        </div>

        {isEditing ? (
          <div className="mt-1.5 space-y-2">
            <Textarea
              rows={2}
              value={draft}
              maxLength={1000}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" loading={isSaving} onClick={onSave}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(comment.content);
                  setIsEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-0.5 text-xs leading-relaxed break-words whitespace-pre-wrap text-ink">
              {comment.content}
            </p>
            {canManage && (
              <div className="mt-1 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="text-[11px] text-ink-subtle transition-colors hover:text-ink"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  className="text-[11px] text-ink-subtle transition-colors hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={onDelete}
        loading={isDeleting}
        title="Delete this comment?"
        description="This cannot be undone."
      />
    </div>
  );
}

export function CommentThread({ taskId, projectId }) {
  const toast = useToast();
  const currentUserId = useSelector(selectCurrentUserId);
  const { isAdmin } = useProjectRole(projectId);
  const { data: comments, isLoading } = useGetCommentsQuery(taskId);
  const [createComment, { isLoading: isPosting }] = useCreateCommentMutation();
  const [draft, setDraft] = useState("");

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!draft.trim()) return;

    try {
      await createComment({
        taskId,
        content: draft.trim(),
      }).unwrap();
      setDraft("");
    } catch (error) {
      toast.error(error, "Could not post the comment.");
    }
  };

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="flex justify-center py-4">
          <Spinner className="text-ink-subtle" />
        </div>
      ) : comments?.length ? (
        <div className="space-y-4">
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              taskId={taskId}
              // Mirrors the API: authors manage their own comments, Admins any.
              canManage={isAdmin || comment.created_by === currentUserId}
            />
          ))}
        </div>
      ) : (
        <p className="py-2 text-xs text-ink-subtle">No comments yet.</p>
      )}

      <form onSubmit={onSubmit} className="space-y-2 border-t border-line pt-3">
        <Textarea
          rows={2}
          maxLength={1000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a comment…"
        />
        <div className="flex justify-end">
          <Button size="sm" type="submit" loading={isPosting} disabled={!draft.trim()}>
            Comment
          </Button>
        </div>
      </form>
    </div>
  );
}
