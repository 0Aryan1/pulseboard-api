import http from "node:http";
import { Server } from "socket.io";
import { io as connectClient } from "socket.io-client";
import request from "supertest";
import app from "../src/app.js";
import prisma from "../src/prisma.js";
import { uploadQueue } from "../src/queue.js";
import { setupSocket } from "../src/socket.js";
import { createTestUser, deleteTestUsers } from "./helpers/testUsers.js";

// Runs the real API and the real Socket.IO server together, so these tests
// see exactly what a browser would receive.
describe("Live project member events", () => {
  let httpServer;
  let io;
  let url;
  let admin;
  let member;
  let projectId;
  const extraUsers = [];
  const clients = [];

  const api = request(app);
  const room = () => `project:${projectId}`;

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

  function nextEvent(client, event) {
    return new Promise((resolve) => client.once(event, resolve));
  }

  // Room changes are not acknowledged, so wait until the server sees them.
  async function waitForRoom(client, roomName, shouldBeInRoom = true) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const sockets = await io.in(roomName).fetchSockets();
      const isInRoom = sockets.some((socket) => socket.id === client.id);

      if (isInRoom === shouldBeInRoom) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Socket never ${shouldBeInRoom ? "joined" : "left"} ${roomName}`);
  }

  async function joinProject(client) {
    client.emit("joinProject", projectId);
    await waitForRoom(client, room());
  }

  async function addMember(user, role = "Member") {
    const response = await api
      .post(`/api/v1/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ userId: user.id, role });

    expect(response.statusCode).toBe(201);
  }

  async function newMember() {
    const user = await createTestUser(api, "Live Member");
    extraUsers.push(user);
    await addMember(user);

    return user;
  }

  beforeAll(async () => {
    httpServer = http.createServer(app);
    io = new Server(httpServer);
    setupSocket(io);

    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;

    admin = await createTestUser(api, "Live Admin");
    member = await createTestUser(api, "Live Watcher");

    const projectResponse = await api
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ title: "Live members project", description: "Socket events" });

    expect(projectResponse.statusCode).toBe(201);
    projectId = projectResponse.body.data.id;

    await addMember(member);
  });

  afterAll(async () => {
    clients.forEach((client) => client.disconnect());
    await new Promise((resolve) => io.close(resolve));
    await deleteTestUsers(prisma, [admin, member, ...extraUsers]);
    await prisma.$disconnect();
    await uploadQueue.close();
  });

  test("puts every socket in its user's room", async () => {
    const client = await connect(member);

    await waitForRoom(client, `user:${member.id}`);
  });

  test("tells the project when a member is added", async () => {
    const watcher = await connect(member);
    await joinProject(watcher);

    const newUser = await createTestUser(api, "Live Newcomer");
    extraUsers.push(newUser);

    const event = nextEvent(watcher, "memberAdded");
    await addMember(newUser);

    expect(await event).toEqual(
      expect.objectContaining({ user_id: newUser.id, project_id: projectId, role: "Member" }),
    );
  });

  test("tells the project when a member's role changes", async () => {
    const watcher = await connect(member);
    await joinProject(watcher);
    const user = await newMember();

    const event = nextEvent(watcher, "memberUpdated");

    const response = await api
      .put(`/api/v1/projects/${projectId}/members/${user.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ role: "Admin" });

    expect(response.statusCode).toBe(200);
    expect(await event).toEqual(
      expect.objectContaining({ user_id: user.id, role: "Admin" }),
    );
  });

  test("tells the remaining members when someone is removed", async () => {
    const watcher = await connect(member);
    await joinProject(watcher);
    const user = await newMember();

    const event = nextEvent(watcher, "memberRemoved");

    const response = await api
      .delete(`/api/v1/projects/${projectId}/members/${user.id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(response.statusCode).toBe(200);
    expect(await event).toEqual(
      expect.objectContaining({ user_id: user.id, project_id: projectId }),
    );
  });

  test("cuts a removed member off from the project's live events", async () => {
    const removedUser = await newMember();
    const removedClient = await connect(removedUser);
    const adminClient = await connect(admin);
    await joinProject(removedClient);
    await joinProject(adminClient);

    const leakedEvents = [];
    removedClient.on("taskCreated", (task) => leakedEvents.push(task));

    const notice = nextEvent(removedClient, "removedFromProject");

    const removeResponse = await api
      .delete(`/api/v1/projects/${projectId}/members/${removedUser.id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(removeResponse.statusCode).toBe(200);
    expect(await notice).toEqual({ projectId });
    await waitForRoom(removedClient, room(), false);

    // The admin still gets the next event; the removed member must not.
    const adminReceived = nextEvent(adminClient, "taskCreated");

    const taskResponse = await api
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ title: "Secret plans", status: "Pending" });

    expect(taskResponse.statusCode).toBe(201);
    await adminReceived;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(leakedEvents).toEqual([]);
  });
});
