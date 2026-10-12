import http from "node:http";
import { Server } from "socket.io";
import { io as connectClient } from "socket.io-client";

// Runs the real API and the real Socket.IO server together on a random port,
// so tests see exactly what a browser would receive.
export async function startLiveServer(app, setupSocket) {
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  setupSocket(io);

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const url = `http://localhost:${httpServer.address().port}`;
  const clients = [];

  function connect(user) {
    const client = connectClient(url, {
      auth: { token: user.token },
      transports: ["websocket"],
      reconnection: false,
    });

    clients.push(client);

    return new Promise((resolve, reject) => {
      client.once("connect", () => resolve(client));
      client.once("connect_error", reject);
    });
  }

  // Room changes are not acknowledged, so wait until the server sees them.
  async function waitForRoom(client, room, shouldBeInRoom = true) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const sockets = await io.in(room).fetchSockets();
      const isInRoom = sockets.some((socket) => socket.id === client.id);

      if (isInRoom === shouldBeInRoom) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Socket never ${shouldBeInRoom ? "joined" : "left"} ${room}`);
  }

  async function joinProject(client, projectId) {
    client.emit("joinProject", projectId);
    await waitForRoom(client, `project:${projectId}`);
  }

  async function close() {
    clients.forEach((client) => client.disconnect());
    await new Promise((resolve) => io.close(resolve));
  }

  return { io, connect, waitForRoom, joinProject, close };
}

export function nextEvent(client, event) {
  return new Promise((resolve) => client.once(event, resolve));
}
