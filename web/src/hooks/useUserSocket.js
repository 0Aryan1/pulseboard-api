import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { selectCurrentUserId, selectToken } from "../features/auth/authSlice.js";
import { logRequest } from "../features/devtools/devLogSlice.js";
import { api } from "../services/api.js";
import { getSocket } from "../services/socket.js";
import { useToast } from "./useToast.js";

/**
 * Keeps app-wide data live on every page, not just inside a project: the
 * server puts each socket in its user's room (src/socket.js), so these events
 * arrive even while no project page is open. The open project page itself is
 * handled by useProjectSocket.
 */
export function useUserSocket() {
  const dispatch = useDispatch();
  const token = useSelector(selectToken);
  const currentUserId = useSelector(selectCurrentUserId);
  // Only the memoised callback goes in the effect's deps: useToast returns a
  // new object every render.
  const { success: showSuccess } = useToast();

  useEffect(() => {
    if (!token) return undefined;

    const socket = getSocket(token);

    const log = (event, payload) =>
      dispatch(
        logRequest({
          method: "WS",
          url: event,
          status: "event",
          ok: true,
          durationMs: 0,
          response: payload,
        })
      );

    const refreshProjectList = () =>
      dispatch(api.util.invalidateTags([{ type: "Project", id: "LIST" }]));

    const handlers = {
      addedToProject: (payload) => {
        refreshProjectList();
        showSuccess(`You were added to "${payload.title}".`);
      },
      // The project page (if open) also leaves and explains; here the list
      // just stops showing the project.
      removedFromProject: refreshProjectList,
      projectDeleted: refreshProjectList,
      projectUpdated: refreshProjectList,
      userUpdated: (user) => {
        // Another tab changed this user's own name or email.
        if (user?.id === currentUserId) {
          dispatch(api.util.invalidateTags([{ type: "User", id: user.id }]));
        }
      },
    };

    const listeners = Object.entries(handlers).map(([event, handler]) => [
      event,
      (payload) => {
        log(event, payload);
        handler(payload);
      },
    ]);

    listeners.forEach(([event, listener]) => socket.on(event, listener));

    if (!socket.connected) {
      socket.connect();
    }

    return () => {
      listeners.forEach(([event, listener]) => socket.off(event, listener));
    };
  }, [dispatch, token, currentUserId, showSuccess]);
}
