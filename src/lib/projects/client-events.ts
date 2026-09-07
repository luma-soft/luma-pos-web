export const PROJECT_DELETED_EVENT = "luma:project-deleted";

export type ProjectDeletedEvent = CustomEvent<{ id: string }>;
