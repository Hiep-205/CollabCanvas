ALTER TABLE tasks
    ADD COLUMN blocked_reason varchar(500),
    ADD CONSTRAINT ck_tasks_blocked_reason CHECK (
        blocked_reason IS NULL OR length(btrim(blocked_reason)) BETWEEN 1 AND 500
    );
