import request from "supertest";
import app from "../src/app.js";
import prisma from "../src/prisma.js";
import { uploadQueue } from "../src/queue.js";
import { setupSocket } from "../src/socket.js";
import { createTestUser, deleteTestUsers } from "./helpers/testUsers.js";
import { nextEvent, startLiveServer } from "./helpers/liveServer.js";

describe("Live project member events", () => {
  let live;
  let admin;
  let member;
  let projectId;
  const extraUsers = [];

  const api = request(app);

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
    live = await startLiveServer(app, setupSocket);

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
    await live.close();
    await deleteTestUsers(prisma, [admin, member, ...extraUsers]);
    await prisma.$disconnect();
    await uploadQueue.close();
  });

  test("puts every socket in its user's room", async () => {
    const client = await live.connect(member);

    await live.waitForRoom(client, `user:${member.id}`);
  });

  test("tells the project when a member is added", async () => {
    const watcher = await live.connect(member);
    await live.joinProject(watcher, projectId);

    const newUser = await createTestUser(api, "Live Newcomer");
    extraUsers.push(newUser);

    const event = nextEvent(watcher, "memberAdded");
    await addMember(newUser);

    expect(await event).toEqual(
      expect.objectContaining({ user_id: newUser.id, project_id: projectId, role: "Member" }),
    );
  });

  test("tells the project when a member's role changes", async () => {
    const watcher = await live.connect(member);
    await live.joinProject(watcher, projectId);
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
    const watcher = await live.connect(member);
    await live.joinProject(watcher, projectId);
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
    const removedClient = await live.connect(removedUser);
    const adminClient = await live.connect(admin);
    await live.joinProject(removedClient, projectId);
    await live.joinProject(adminClient, projectId);

    const leakedEvents = [];
    removedClient.on("taskCreated", (task) => leakedEvents.push(task));

    const notice = nextEvent(removedClient, "removedFromProject");

    const removeResponse = await api
      .delete(`/api/v1/projects/${projectId}/members/${removedUser.id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(removeResponse.statusCode).toBe(200);
    expect(await notice).toEqual({ projectId });
    await live.waitForRoom(removedClient, `project:${projectId}`, false);

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
