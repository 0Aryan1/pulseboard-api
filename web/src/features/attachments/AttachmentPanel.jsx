import { useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Button } from "../../components/ui/Button.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { ConfirmDialog } from "../../components/ui/Modal.jsx";
import { useToast } from "../../hooks/useToast.js";
import { useProjectRole } from "../../hooks/useProjectRole.js";
import { selectCurrentUserId, selectToken } from "../auth/authSlice.js";
import { fetchAttachmentBlob, saveBlob } from "../../lib/download.js";
import { API_BASE_URL } from "../../services/baseQuery.js";
import {
  ACCEPTED_FILE_HINT,
  ACCEPTED_MIME_TYPES,
  ATTACHMENT_STATUS,
  MAX_FILE_SIZE,
} from "../../lib/constants.js";
import { formatRelative } from "../../lib/format.js";
import {
  useDeleteAttachmentMutation,
  useGetAttachmentsQuery,
  useUploadAttachmentMutation,
} from "../../services/endpoints/attachments.api.js";

function AttachmentRow({ attachment, taskId, projectId }) {
  const toast = useToast();
  const token = useSelector(selectToken);
  const currentUserId = useSelector(selectCurrentUserId);
  const { isAdmin } = useProjectRole(projectId);
  // Mirrors the API: uploaders delete their own files, Admins any.
  const canDelete = isAdmin || attachment.uploaded_by === currentUserId;
  const [isDownloading, setIsDownloading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteAttachment, { isLoading: isDeleting }] = useDeleteAttachmentMutation();

  const onDownload = async () => {
    setIsDownloading(true);

    try {
      const blob = await fetchAttachmentBlob({
        baseUrl: API_BASE_URL,
        taskId,
        attachmentId: attachment.id,
        token,
      });
      saveBlob(blob, attachment.file_name);
    } catch (error) {
      toast.error(error.message, "Could not download the file.");
    } finally {
      setIsDownloading(false);
    }
  };

  const onDelete = async () => {
    try {
      await deleteAttachment({ taskId, attachmentId: attachment.id }).unwrap();
      setConfirmOpen(false);
      toast.success("Attachment deleted.");
    } catch (error) {
      toast.error(error, "Could not delete the attachment.");
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-50 text-[10px] font-semibold text-brand-700">
        {(attachment.file_name.split(".").pop() ?? "").slice(0, 4).toUpperCase()}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{attachment.file_name}</p>
        <p className="text-[11px] text-ink-subtle">
          {formatRelative(attachment.created_at)}
        </p>
      </div>

      {/* The server refuses downloads until the upload worker has marked the
          file ready; a socket event refreshes this row when it does. */}
      {attachment.status === ATTACHMENT_STATUS.PROCESSING ? (
        <Badge tone="brand" className="gap-1.5">
          <Spinner className="size-3" />
          Processing
        </Badge>
      ) : attachment.status === ATTACHMENT_STATUS.FAILED ? (
        <Badge tone="danger">Failed</Badge>
      ) : (
        <button
          type="button"
          onClick={onDownload}
          disabled={isDownloading}
          className="text-[11px] text-ink-subtle transition-colors hover:text-ink disabled:opacity-50"
        >
          {isDownloading ? "…" : "Download"}
        </button>
      )}

      {canDelete && (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="text-[11px] text-ink-subtle transition-colors hover:text-red-600"
        >
          Delete
        </button>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={onDelete}
        loading={isDeleting}
        title="Delete this attachment?"
        description={`${attachment.file_name} will be removed from disk as well.`}
      />
    </li>
  );
}

export function AttachmentPanel({ taskId, projectId }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const { data: attachments, isLoading } = useGetAttachmentsQuery(taskId);
  const [uploadAttachment, { isLoading: isUploading }] = useUploadAttachmentMutation();

  const onPick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    // Mirror the server's multer limits so the failure is immediate and clear.
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`"${file.name}" is larger than 5 MB.`);
      return;
    }

    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      toast.error(`"${file.name}" is not an accepted file type.`);
      return;
    }

    try {
      await uploadAttachment({ taskId, file }).unwrap();
      toast.success("File uploaded. It will be downloadable once processing finishes.");
    } catch (error) {
      toast.error(error, "Could not upload the file.");
    }
  };

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="flex justify-center py-3">
          <Spinner className="text-ink-subtle" />
        </div>
      ) : attachments?.length ? (
        <ul className="space-y-2">
          {attachments.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              attachment={attachment}
              taskId={taskId}
              projectId={projectId}
            />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-subtle">No files attached.</p>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPTED_MIME_TYPES.join(",")}
        onChange={onPick}
      />

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          loading={isUploading}
          onClick={() => inputRef.current?.click()}
        >
          Upload file
        </Button>
        <span className="text-[11px] text-ink-subtle">{ACCEPTED_FILE_HINT}</span>
      </div>
    </div>
  );
}
