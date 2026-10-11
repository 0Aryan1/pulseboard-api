-- Records who uploaded each attachment so the uploader (or an Admin) can
-- delete it. Existing attachments predate this and stay NULL, which leaves
-- them to Admins. Like tasks and comments (012), an upload outlives its author.
ALTER TABLE attachments
ADD COLUMN uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
