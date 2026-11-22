CREATE TABLE task_checklist_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    title varchar(200) NOT NULL,
    is_done boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_task_checklist_items_task FOREIGN KEY (workspace_id, task_id)
        REFERENCES tasks (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_task_checklist_items_title CHECK (length(btrim(title)) > 0),
    CONSTRAINT ck_task_checklist_items_sort_order CHECK (sort_order >= 0)
);

CREATE INDEX ix_task_checklist_items_task_order
    ON task_checklist_items (workspace_id, task_id, sort_order, created_at, id);
