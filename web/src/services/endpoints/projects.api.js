import { api } from "../api.js";
import { PAGE_SIZE } from "../../lib/constants.js";

export const projectsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Returns only projects the caller is a member of.
    getProjects: builder.query({
      query: ({ page = 1, limit = PAGE_SIZE } = {}) => ({
        url: "/projects",
        params: { page, limit },
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.map((project) => ({ type: "Project", id: project.id })),
              { type: "Project", id: "LIST" },
            ]
          : [{ type: "Project", id: "LIST" }],
    }),

    getProject: builder.query({
      query: (projectId) => `/projects/${projectId}`,
      providesTags: (result, error, projectId) => [
        { type: "Project", id: projectId },
      ],
    }),

    createProject: builder.mutation({
      query: (body) => ({
        url: "/projects",
        method: "POST",
        body,
      }),
      invalidatesTags: [{ type: "Project", id: "LIST" }],
    }),

    updateProject: builder.mutation({
      query: ({ projectId, ...body }) => ({
        url: `/projects/${projectId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (result, error, { projectId }) => [
        { type: "Project", id: projectId },
        { type: "Project", id: "LIST" },
      ],
    }),

    // Owner-only. The incoming owner must already be a project member and is
    // promoted to Admin server-side, since the owner always holds Admin.
    transferOwnership: builder.mutation({
      query: ({ projectId, userId }) => ({
        url: `/projects/${projectId}/owner`,
        method: "PUT",
        body: { userId },
      }),
      invalidatesTags: (result, error, { projectId }) => [
        { type: "Project", id: projectId },
        { type: "Member", id: `PROJECT-${projectId}` },
      ],
    }),

    deleteProject: builder.mutation({
      query: (projectId) => ({
        url: `/projects/${projectId}`,
        method: "DELETE",
      }),
      invalidatesTags: [{ type: "Project", id: "LIST" }],
    }),
  }),
});

export const {
  useGetProjectsQuery,
  useGetProjectQuery,
  useCreateProjectMutation,
  useUpdateProjectMutation,
  useTransferOwnershipMutation,
  useDeleteProjectMutation,
} = projectsApi;
