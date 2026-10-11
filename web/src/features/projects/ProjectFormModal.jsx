import { useState } from "react";
import { Modal, ModalActions } from "../../components/ui/Modal.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Input, Textarea } from "../../components/ui/Field.jsx";
import { useToast } from "../../hooks/useToast.js";
import {
  useCreateProjectMutation,
  useUpdateProjectMutation,
} from "../../services/endpoints/projects.api.js";

/**
 * The form body mounts only while the modal is open, so its state starts fresh
 * on every open without a reset effect.
 */
function ProjectForm({ project, onClose }) {
  const toast = useToast();
  const isEdit = Boolean(project);

  const [createProject, { isLoading: isCreating }] = useCreateProjectMutation();
  const [updateProject, { isLoading: isUpdating }] = useUpdateProjectMutation();

  const [form, setForm] = useState({
    title: project?.title ?? "",
    description: project?.description ?? "",
  });

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const onSubmit = async (event) => {
    event.preventDefault();

    try {
      if (isEdit) {
        await updateProject({ projectId: project.id, ...form }).unwrap();
        toast.success("Project updated.");
      } else {
        await createProject(form).unwrap();
        toast.success("Project created. You were added as Admin.");
      }

      onClose();
    } catch (error) {
      toast.error(error, "Could not save the project.");
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Input
        label="Title"
        required
        maxLength={100}
        value={form.title}
        onChange={update("title")}
        placeholder="Website redesign"
      />
      <Textarea
        label="Description"
        // createProjectSchema requires a non-empty description; update allows blank.
        required={!isEdit}
        maxLength={500}
        rows={4}
        value={form.description}
        onChange={update("description")}
        placeholder="What is this project about?"
      />
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={isCreating || isUpdating}>
          {isEdit ? "Save changes" : "Create project"}
        </Button>
      </ModalActions>
    </form>
  );
}

/** Handles both create and edit; `project` present means edit. */
export function ProjectFormModal({ open, onClose, project }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? "Edit project" : "New project"}
      description={project ? undefined : "You become the project Admin automatically."}
    >
      <ProjectForm project={project} onClose={onClose} />
    </Modal>
  );
}
