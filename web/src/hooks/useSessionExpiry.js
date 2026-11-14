import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { selectToken, sessionExpired } from "../features/auth/authSlice.js";
import { getTokenExpiry } from "../lib/jwt.js";
import { useToast } from "./useToast.js";

/**
 * Signs the user out the moment their token expires. Without this the app
 * only noticed on the next reload (authSlice) or the next request's 401
 * (baseQuery), and the live socket kept running on a dead session.
 */
export function useSessionExpiry() {
  const dispatch = useDispatch();
  const token = useSelector(selectToken);
  // Only the memoised callback goes in the effect's deps: useToast returns a
  // new object every render.
  const { error: showError } = useToast();

  useEffect(() => {
    const expiresAt = getTokenExpiry(token);
    if (!expiresAt) return undefined;

    const expire = () => {
      dispatch(sessionExpired());
      showError("Your session expired. Please sign in again.");
    };

    const timer = setTimeout(expire, Math.max(expiresAt - Date.now(), 0));

    return () => clearTimeout(timer);
  }, [dispatch, token, showError]);
}
