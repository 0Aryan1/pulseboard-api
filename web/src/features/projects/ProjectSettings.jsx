import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardHeader } from "../../components/ui/Card.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmDialog } from "../../components/ui/Modal.jsx";
import { ProjectFormModal } from "./ProjectFormModal.jsx";
import { useToast } from "../../hooks/useToast.js";
import { useProjectRole } from "../../hooks/useProjectRole.js";
import { formatDateTime } from "../../lib/format.js";
import { useDeleteProjectMutation } from "../../services/endpoints/projects.api.js";

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-right text-xs font-medium break-words">{value}</span>
    </div>
  );
}

export function ProjectSettings({ project }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { isAdmin } = useProjectRole(project.id);

  // One value, so only one dialog can be open at a time.
  const [dialog, setDialog] = useState(null); // null | "edit" | "delete"
  const [deleteProject, { isLoading: isDeleting }] = useDeleteProjectMutation();

  const onDelete = async () => {
    try {
      await deleteProject(project.id).unwrap();
      toast.success("Project deleted.");
      navigate("/projects", { replace: true });
    } catch (error) {
      toast.error(error, "Could not delete the project.");
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <CardHeader
          title="Project details"
          action={
            isAdmin && (
              <Button size="sm" variant="secondary" onClick={() => setDialog("edit")}>
                Edit
              </Button>
            )
          }
        />
        <div className="divide-y divide-line">
          <Row label="ID" value={`#${project.id}`} />
          <Row label="Title" value={project.title} />
          <Row label="Description" value={project.description || "—"} />
          <Row label="Owner user ID" value={`#${project.owner_id}`} />
          <Row label="Created" value={formatDateTime(project.created_at)} />
        </div>
      </Card>

      {isAdmin ? (
        <Card className="border-red-200">
          <CardHeader title="Danger zone" className="border-red-200" />
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <p className="text-xs text-ink-muted">
              Deleting a project also removes its tasks, comments, and attachments.
            </p>
            <Button variant="danger" size="sm" onClick={() => setDialog("delete")}>
              Delete project
            </Button>
          </div>
        </Card>
      ) : (
        <p className="text-xs text-ink-subtle">
          Only project Admins can edit or delete this project.
        </p>
      )}

      <ProjectFormModal
        open={dialog === "edit"}
        onClose={() => setDialog(null)}
        project={project}
      />

      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onConfirm={onDelete}
        loading={isDeleting}
        title={`Delete "${project.title}"?`}
        description="Every task, comment, and attachment in it is removed. This cannot be undone."
      />
    </div>
  );
}
