import request from "supertest";
import app from "../src/app.js";
import prisma from "../src/prisma.js";
import { uploadQueue } from "../src/queue.js";
import { setupSocket } from "../src/socket.js";
import { createTestUser, deleteTestUsers } from "./helpers/testUsers.js";
import { nextEvent, startLiveServer } from "./helpers/liveServer.js";

describe("Live project events", () => {
  let live;
  let owner;
  let member;

  const api = request(app);

  // Each test gets its own project, since some tests delete or hand it over.
  async function createProject() {
    const projectResponse = await api
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title: "Live project", description: "Project events" });

    expect(projectResponse.statusCode).toBe(201);
    const projectId = projectResponse.body.data.id;

    const memberResponse = await api
      .post(`/api/v1/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ userId: member.id, role: "Member" });

    expect(memberResponse.statusCode).toBe(201);

    return projectId;
  }

  async function watch(projectId) {
    const watcher = await live.connect(member);
    await live.joinProject(watcher, projectId);

    return watcher;
  }

  beforeAll(async () => {
    live = await startLiveServer(app, setupSocket);
    owner = await createTestUser(api, "Live Project Owner");
    member = await createTestUser(api, "Live Project Member");
  });

  afterAll(async () => {
    await live.close();
    await deleteTestUsers(prisma, [owner, member]);
    await prisma.$disconnect();
    await uploadQueue.close();
  });

  test("tells the project when it is renamed", async () => {
    const projectId = await createProject();
    const watcher = await watch(projectId);

    const event = nextEvent(watcher, "projectUpdated");

    const response = await api
      .put(`/api/v1/projects/${projectId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title: "Renamed live", description: "New description" });

    expect(response.statusCode).toBe(200);
    expect(await event).toEqual(
      expect.objectContaining({ id: projectId, title: "Renamed live" }),
    );
  });

  test("tells the project about a new owner and their Admin role", async () => {
    const projectId = await createProject();
    const watcher = await watch(projectId);

    const projectEvent = nextEvent(watcher, "projectUpdated");
    const memberEvent = nextEvent(watcher, "memberUpdated");

    const response = await api
      .put(`/api/v1/projects/${projectId}/owner`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ userId: member.id });

    expect(response.statusCode).toBe(200);
    expect(await projectEvent).toEqual(
      expect.objectContaining({ id: projectId, owner_id: member.id }),
    );
    expect(await memberEvent).toEqual({
      project_id: projectId,
      user_id: member.id,
      role: "Admin",
    });
  });

  test("tells members a project was deleted and empties its room", async () => {
    const projectId = await createProject();
    const watcher = await watch(projectId);

    const event = nextEvent(watcher, "projectDeleted");

    const response = await api
      .delete(`/api/v1/projects/${projectId}`)
      .set("Authorization", `Bearer ${owner.token}`);

    expect(response.statusCode).toBe(200);
    expect(await event).toEqual({ projectId, deletedBy: owner.id });
    await live.waitForRoom(watcher, `project:${projectId}`, false);
  });
});
