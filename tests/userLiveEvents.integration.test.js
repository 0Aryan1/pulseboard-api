import request from "supertest";
import app from "../src/app.js";
import prisma from "../src/prisma.js";
import { uploadQueue } from "../src/queue.js";
import { setupSocket } from "../src/socket.js";
import { createTestUser, deleteTestUsers } from "./helpers/testUsers.js";
import { nextEvent, startLiveServer } from "./helpers/liveServer.js";

// Events that reach a user wherever they are in the app, e.g. on the projects
// list, not just while a project page is open.
describe("Live per-user events", () => {
  let live;
  let owner;
  const extraUsers = [];

  const api = request(app);

  async function newUser(name) {
    const user = await createTestUser(api, name);
    extraUsers.push(user);

    return user;
  }

  async function createProject(title = "Per-user project") {
    const response = await api
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title, description: "Per-user events" });

    expect(response.statusCode).toBe(201);

    return response.body.data.id;
  }

  async function addMember(projectId, user) {
    const response = await api
      .post(`/api/v1/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ userId: user.id, role: "Member" });

    expect(response.statusCode).toBe(201);
  }

  beforeAll(async () => {
    live = await startLiveServer(app, setupSocket);
    owner = await createTestUser(api, "Per-user Owner");
  });

  afterAll(async () => {
    await live.close();
    await deleteTestUsers(prisma, [owner, ...extraUsers]);
    await prisma.$disconnect();
    await uploadQueue.close();
  });

  describe("projects list", () => {
    test("tells a user they were added to a project", async () => {
      const projectId = await createProject("Welcome project");
      const user = await newUser("Newly Added");
      const listPage = await live.connect(user);

      const event = nextEvent(listPage, "addedToProject");
      await addMember(projectId, user);

      expect(await event).toEqual({
        projectId,
        title: "Welcome project",
        role: "Member",
      });
    });

    test("tells members outside the project page about a rename", async () => {
      const projectId = await createProject();
      const user = await newUser("List Viewer");
      await addMember(projectId, user);
      const listPage = await live.connect(user);

      const event = nextEvent(listPage, "projectUpdated");

      const response = await api
        .put(`/api/v1/projects/${projectId}`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ title: "Renamed for the list" });

      expect(response.statusCode).toBe(200);
      expect(await event).toEqual(
        expect.objectContaining({ id: projectId, title: "Renamed for the list" }),
      );
    });

    test("tells members outside the project page about a deletion, once each", async () => {
      const projectId = await createProject();
      const user = await newUser("Deletion Viewer");
      await addMember(projectId, user);

      const listPage = await live.connect(user);
      const projectPage = await live.connect(user);
      await live.joinProject(projectPage, projectId);

      const listEvents = [];
      const projectPageEvents = [];
      listPage.on("projectDeleted", (payload) => listEvents.push(payload));
      projectPage.on("projectDeleted", (payload) => projectPageEvents.push(payload));

      const response = await api
        .delete(`/api/v1/projects/${projectId}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(response.statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // The project page is in both the project room and the user room.
      expect(listEvents).toEqual([{ projectId, deletedBy: owner.id }]);
      expect(projectPageEvents).toEqual([{ projectId, deletedBy: owner.id }]);
    });
  });

  describe("profile changes", () => {
    test("tells the user's projects and other tabs about a profile update", async () => {
      const projectId = await createProject();
      const user = await newUser("Before Rename");
      await addMember(projectId, user);

      const teammate = await live.connect(owner);
      await live.joinProject(teammate, projectId);
      const otherTab = await live.connect(user);

      const teammateEvent = nextEvent(teammate, "userUpdated");
      const otherTabEvent = nextEvent(otherTab, "userUpdated");

      const response = await api
        .put(`/api/v1/users/${user.id}`)
        .set("Authorization", `Bearer ${user.token}`)
        .send({ name: "After Rename", email: user.email });

      expect(response.statusCode).toBe(200);

      const expected = {
        id: user.id,
        name: "After Rename",
        email: user.email,
        created_at: expect.any(String),
      };

      expect(await teammateEvent).toEqual(expected);
      expect(await otherTabEvent).toEqual(expected);
    });

    test("sends a profile update once to a tab that is also on a shared project", async () => {
      const projectId = await createProject();
      const user = await newUser("Single Delivery");
      await addMember(projectId, user);

      const projectPage = await live.connect(user);
      await live.joinProject(projectPage, projectId);
      const received = [];
      projectPage.on("userUpdated", (payload) => received.push(payload));

      const response = await api
        .put(`/api/v1/users/${user.id}`)
        .set("Authorization", `Bearer ${user.token}`)
        .send({ name: "Renamed Once", email: user.email });

      expect(response.statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(received).toHaveLength(1);
    });

    test("tells the user's projects about a deleted account and disconnects it", async () => {
      const projectId = await createProject();
      const user = await createTestUser(api, "Leaving User");
      await addMember(projectId, user);

      const teammate = await live.connect(owner);
      await live.joinProject(teammate, projectId);
      const leavingTab = await live.connect(user);

      const teammateEvent = nextEvent(teammate, "userDeleted");
      const disconnected = nextEvent(leavingTab, "disconnect");

      try {
        const response = await api
          .delete(`/api/v1/users/${user.id}`)
          .set("Authorization", `Bearer ${user.token}`);

        expect(response.statusCode).toBe(200);
        expect(await teammateEvent).toEqual({ id: user.id });
        expect(await disconnected).toBe("io server disconnect");
      } finally {
        await deleteTestUsers(prisma, [user]);
      }
    });
  });
});
