import { useState } from "react";
import { Modal, ModalActions } from "../../components/ui/Modal.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Input, Select, Textarea } from "../../components/ui/Field.jsx";
import { useToast } from "../../hooks/useToast.js";
import { TASK_STATUS, TASK_STATUS_LIST } from "../../lib/constants.js";
import {
  useCreateTaskMutation,
  useUpdateTaskMutation,
} from "../../services/endpoints/tasks.api.js";

/**
 * Mounted only while the modal is open, so the draft resets on every open
 * without a synchronising effect.
 */
function TaskForm({ projectId, task, defaultStatus, onClose }) {
  const toast = useToast();
  const isEdit = Boolean(task);

  const [createTask, { isLoading: isCreating }] = useCreateTaskMutation();
  const [updateTask, { isLoading: isUpdating }] = useUpdateTaskMutation();

  const [form, setForm] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    status: task?.status ?? defaultStatus ?? TASK_STATUS.PENDING,
  });

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const onSubmit = async (event) => {
    event.preventDefault();

    try {
      if (isEdit) {
        await updateTask({ projectId, taskId: task.id, ...form }).unwrap();
        toast.success("Task updated.");
      } else {
        await createTask({ projectId, ...form }).unwrap();
        toast.success("Task created.");
      }

      onClose();
    } catch (error) {
      toast.error(error, "Could not save the task.");
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
        placeholder="Ship the landing page"
      />
      <Textarea
        label="Description"
        maxLength={500}
        rows={4}
        value={form.description}
        onChange={update("description")}
        placeholder="Optional detail for whoever picks this up."
      />
      <Select label="Status" value={form.status} onChange={update("status")}>
        {TASK_STATUS_LIST.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </Select>
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={isCreating || isUpdating}>
          {isEdit ? "Save changes" : "Create task"}
        </Button>
      </ModalActions>
    </form>
  );
}

export function TaskFormModal({ open, onClose, projectId, task, defaultStatus }) {
  return (
    <Modal open={open} onClose={onClose} title={task ? "Edit task" : "New task"} size="lg">
      <TaskForm
        projectId={projectId}
        task={task}
        defaultStatus={defaultStatus}
        onClose={onClose}
      />
    </Modal>
  );
}
