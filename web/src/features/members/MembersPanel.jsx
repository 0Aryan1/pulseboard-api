import { useState } from "react";
import { useSelector } from "react-redux";
import { Card, EmptyState, Skeleton } from "../../components/ui/Card.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Avatar } from "../../components/ui/Avatar.jsx";
import { Badge, RoleBadge } from "../../components/ui/Badge.jsx";
import { ConfirmDialog } from "../../components/ui/Modal.jsx";
import { AddMemberModal } from "./AddMemberModal.jsx";
import { useToast } from "../../hooks/useToast.js";
import { useProjectRole } from "../../hooks/useProjectRole.js";
import { selectCurrentUserId } from "../auth/authSlice.js";
import { PROJECT_ROLE_LIST } from "../../lib/constants.js";
import {
  useGetMembersQuery,
  useRemoveMemberMutation,
  useUpdateMemberRoleMutation,
} from "../../services/endpoints/members.api.js";
import {
  useGetProjectQuery,
  useTransferOwnershipMutation,
} from "../../services/endpoints/projects.api.js";

function MemberRow({ member, projectId, canManage, isSelf, isOwner, canTransfer }) {
  const toast = useToast();
  // One value, so only one dialog can be open at a time.
  const [dialog, setDialog] = useState(null); // null | "remove" | "transfer"
  const [updateRole, { isLoading: isUpdating }] = useUpdateMemberRoleMutation();
  const [removeMember, { isLoading: isRemoving }] = useRemoveMemberMutation();
  const [transferOwnership, { isLoading: isTransferring }] =
    useTransferOwnershipMutation();

  const onRoleChange = async (event) => {
    // Read the value before awaiting: the refetch can unmount this select (for
    // example when you demote yourself and lose the Admin controls), and a
    // detached element no longer reports the chosen role.
    const role = event.target.value;

    try {
      await updateRole({ projectId, userId: member.id, role }).unwrap();
      toast.success(`${member.name} is now ${role}.`);
    } catch (error) {
      toast.error(error, "Could not change the role.");
    }
  };

  const onRemove = async () => {
    try {
      await removeMember({ projectId, userId: member.id }).unwrap();
      setDialog(null);
      toast.success("Member removed.");
    } catch (error) {
      toast.error(error, "Could not remove the member.");
    }
  };

  const onTransfer = async () => {
    try {
      await transferOwnership({ projectId, userId: member.id }).unwrap();
      setDialog(null);
      toast.success(`${member.name} is now the project owner.`);
    } catch (error) {
      toast.error(error, "Could not transfer ownership.");
    }
  };

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Avatar name={member.name} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          {member.name}
          {isSelf && <span className="text-[11px] text-ink-subtle">(you)</span>}
          {isOwner && <Badge tone="brand">Owner</Badge>}
        </p>
        <p className="truncate text-xs text-ink-muted">{member.email}</p>
      </div>

      {/* The owner is always an Admin, so their role is not editable and they
          cannot be removed until ownership is transferred away. The API
          enforces the same rule. */}
      {isOwner ? (
        <span title="The project owner is always an Admin. Transfer ownership to change this.">
          <RoleBadge role={member.role} />
        </span>
      ) : canManage ? (
        <select
          value={member.role}
          onChange={onRoleChange}
          disabled={isUpdating}
          className="cursor-pointer rounded-lg border border-line bg-surface px-2 py-1 text-xs transition-colors hover:border-zinc-300 focus:border-brand-400"
        >
          {PROJECT_ROLE_LIST.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      ) : (
        <RoleBadge role={member.role} />
      )}

      {/* Only the current owner can hand ownership over. */}
      {canTransfer && (
        <button
          type="button"
          onClick={() => setDialog("transfer")}
          className="text-xs whitespace-nowrap text-ink-subtle transition-colors hover:text-brand-700"
        >
          Make owner
        </button>
      )}

      {canManage && !isOwner && (
        <button
          type="button"
          onClick={() => setDialog("remove")}
          className="text-xs text-ink-subtle transition-colors hover:text-red-600"
        >
          Remove
        </button>
      )}

      <ConfirmDialog
        open={dialog === "remove"}
        onClose={() => setDialog(null)}
        onConfirm={onRemove}
        loading={isRemoving}
        confirmLabel="Remove"
        title={`Remove ${member.name}?`}
        description={
          isSelf
            ? "You will lose access to this project immediately."
            : "They lose access to this project and its tasks."
        }
      />

      <ConfirmDialog
        open={dialog === "transfer"}
        onClose={() => setDialog(null)}
        onConfirm={onTransfer}
        loading={isTransferring}
        confirmLabel="Transfer ownership"
        title={`Make ${member.name} the owner?`}
        description={`${member.name} becomes an Admin and takes ownership of this project. You stay an Admin, but only they will be able to transfer ownership afterwards.`}
      />
    </li>
  );
}

export function MembersPanel({ projectId }) {
  const currentUserId = useSelector(selectCurrentUserId);
  const { isAdmin } = useProjectRole(projectId);
  const { data: members, isLoading } = useGetMembersQuery(projectId);
  // Already cached by ProjectDetailPage; RTK Query dedupes the request.
  const { data: project } = useGetProjectQuery(projectId);
  const [addOpen, setAddOpen] = useState(false);

  const isCurrentUserOwner = Boolean(project) && project.owner_id === currentUserId;

  if (isLoading) {
    return <Skeleton className="h-48 rounded-xl" />;
  }

  return (
    <>
      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm">
            Members
            <span className="ml-2 text-xs font-normal text-ink-muted">
              {members?.length ?? 0}
            </span>
          </h3>
          {isAdmin && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              Add member
            </Button>
          )}
        </div>

        {members?.length ? (
          <ul className="divide-y divide-line">
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                projectId={projectId}
                canManage={isAdmin}
                isSelf={member.id === currentUserId}
                isOwner={member.id === project?.owner_id}
                canTransfer={isCurrentUserOwner && member.id !== project?.owner_id}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No members"
            description="Add teammates so they can see this project."
          />
        )}
      </Card>

      {!isAdmin && (
        <p className="mt-3 text-xs text-ink-subtle">
          Only project Admins can add, remove, or change the role of a member.
        </p>
      )}

      <AddMemberModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        projectId={projectId}
        existingMemberIds={(members ?? []).map((member) => member.id)}
      />
    </>
  );
}
