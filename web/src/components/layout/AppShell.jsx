import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Topbar } from "./Topbar.jsx";
import { DevPanel } from "../../features/devtools/DevPanel.jsx";
import { disconnectSocket } from "../../services/socket.js";
import { useUserSocket } from "../../hooks/useUserSocket.js";

export function AppShell() {
  // The shell only renders while signed in, so unmounting means sign-out or
  // an expired session: drop the authenticated socket with it.
  useEffect(() => disconnectSocket, []);
  useUserSocket();

  return (
    <div className="flex min-h-screen flex-col">
      <Topbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Outlet />
      </main>
      <DevPanel />
    </div>
  );
}
