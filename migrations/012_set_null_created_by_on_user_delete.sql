-- Deleting a user used to fail while they had written any task or comment,
-- because created_by referenced users(id) with NO ACTION. Their tasks and
-- comments belong to the project, so keep them and clear the author instead.
ALTER TABLE tasks
DROP CONSTRAINT tasks_created_by_fkey,
ADD CONSTRAINT tasks_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE comments
DROP CONSTRAINT comments_created_by_fkey,
ADD CONSTRAINT comments_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
