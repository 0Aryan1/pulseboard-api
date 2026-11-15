import { api } from "../api.js";

export const tasksApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getTasks: builder.query({
      query: (projectId) => `/projects/${projectId}/tasks`,
      providesTags: (result, error, projectId) => [
        { type: "Task", id: `PROJECT-${projectId}` },
      ],
    }),

    getTask: builder.query({
      query: ({ projectId, taskId }) => `/projects/${projectId}/tasks/${taskId}`,
      providesTags: (result, error, { taskId }) => [{ type: "Task", id: taskId }],
    }),

    createTask: builder.mutation({
      query: ({ projectId, ...body }) => ({
        url: `/projects/${projectId}/tasks`,
        method: "POST",
        body,
      }),
      invalidatesTags: (result, error, { projectId }) => [
        { type: "Task", id: `PROJECT-${projectId}` },
      ],
    }),

    // PUT, but only status is required: a status change sends just
    // { status }, and the title/description are left as they are.
    updateTask: builder.mutation({
      query: ({ projectId, taskId, ...body }) => ({
        url: `/projects/${projectId}/tasks/${taskId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (result, error, { projectId, taskId }) => [
        { type: "Task", id: `PROJECT-${projectId}` },
        { type: "Task", id: taskId },
      ],
    }),

    deleteTask: builder.mutation({
      query: ({ projectId, taskId }) => ({
        url: `/projects/${projectId}/tasks/${taskId}`,
        method: "DELETE",
      }),
      invalidatesTags: (result, error, { projectId }) => [
        { type: "Task", id: `PROJECT-${projectId}` },
      ],
    }),
  }),
});

export const {
  useGetTasksQuery,
  useGetTaskQuery,
  useCreateTaskMutation,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
} = tasksApi;
