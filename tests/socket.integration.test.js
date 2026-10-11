import http from "node:http";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { io as connectClient } from "socket.io-client";
import prisma from "../src/prisma.js";
import { setupSocket, emitToProject } from "../src/socket.js";
import { deleteTestUsers } from "./helpers/testUsers.js";

describe("Socket.IO project rooms", () => {
  let httpServer;
  let io;
  let url;
  let member;
  let outsider;
  let projectId;
  const clients = [];

  async function createUser(name) {
    const user = await prisma.users.create({
      data: { name, email: `test-${randomUUID()}@example.com` },
    });

    return { id: user.id, token: jwt.sign({ userId: user.id }, process.env.JWT_SECRET) };
  }

  function connect(token) {
    const client = connectClient(url, {
      auth: token === undefined ? {} : { token },
      transports: ["websocket"],
      reconnection: false,
    });

    clients.push(client);

    return client;
  }

  function nextEvent(client, event) {
    return new Promise((resolve) => client.once(event, resolve));
  }

  async function connected(client) {
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });

    return client;
  }

  // joinProject and leaveProject send no acknowledgement, so wait until the
  // server sees the socket enter or leave the room.
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

  beforeAll(async () => {
    httpServer = http.createServer();
    io = new Server(httpServer);
    setupSocket(io);

    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;

    member = await createUser("Socket Member");
    outsider = await createUser("Socket Outsider");

    const project = await prisma.projects.create({
      data: { title: "Socket test project", owner_id: member.id },
    });

    projectId = project.id;

    await prisma.project_members.create({
      data: { user_id: member.id, project_id: projectId, role: "Admin" },
    });
  });

  afterAll(async () => {
    clients.forEach((client) => client.disconnect());
    await new Promise((resolve) => io.close(resolve));
    await deleteTestUsers(prisma, [member, outsider]);
    await prisma.$disconnect();
  });

  test("rejects a connection without a token", async () => {
    const client = connect(undefined);

    const error = await nextEvent(client, "connect_error");

    expect(error.message).toBe("Authentication required");
  });

  test("rejects a connection with an invalid token", async () => {
    const client = connect("not-a-jwt");

    const error = await nextEvent(client, "connect_error");

    expect(error.message).toBe("Invalid or expired token");
  });

  test("delivers project events to a member who joined the room", async () => {
    const client = await connected(connect(member.token));

    client.emit("joinProject", projectId);
    await waitForRoom(client, `project:${projectId}`);

    const received = nextEvent(client, "taskCreated");
    emitToProject(projectId, "taskCreated", { id: 1, title: "Live task" });

    expect(await received).toEqual({ id: 1, title: "Live task" });
  });

  test("refuses to let a non-member join and keeps events from them", async () => {
    const memberClient = await connected(connect(member.token));
    const outsiderClient = await connected(connect(outsider.token));
    const outsiderEvents = [];
    outsiderClient.on("taskCreated", (data) => outsiderEvents.push(data));

    memberClient.emit("joinProject", projectId);
    await waitForRoom(memberClient, `project:${projectId}`);

    const projectError = nextEvent(outsiderClient, "projectError");
    outsiderClient.emit("joinProject", projectId);

    expect(await projectError).toBe("You do not have access to this project");

    const memberReceived = nextEvent(memberClient, "taskCreated");
    emitToProject(projectId, "taskCreated", { id: 2 });
    await memberReceived;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(outsiderEvents).toEqual([]);
  });

  test("rejects an invalid project id", async () => {
    const client = await connected(connect(member.token));

    const projectError = nextEvent(client, "projectError");
    client.emit("joinProject", "abc");

    expect(await projectError).toBe("Invalid project ID");
  });

  test("stops delivering events after leaving the room", async () => {
    const client = await connected(connect(member.token));
    const room = `project:${projectId}`;

    client.emit("joinProject", projectId);
    await waitForRoom(client, room);

    client.emit("leaveProject", projectId);
    await waitForRoom(client, room, false);

    const events = [];
    client.on("taskCreated", (data) => events.push(data));

    emitToProject(projectId, "taskCreated", { id: 3 });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(events).toEqual([]);
  });
});
