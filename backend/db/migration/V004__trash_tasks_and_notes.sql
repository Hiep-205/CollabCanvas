ALTER TABLE tasks ADD COLUMN deleted_at timestamptz;
CREATE INDEX ix_tasks_workspace_deleted_at ON tasks (workspace_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;

ALTER TABLE canvas_nodes ADD COLUMN deleted_at timestamptz;
ALTER TABLE canvas_nodes ADD CONSTRAINT ck_canvas_nodes_deleted_only_note
    CHECK (deleted_at IS NULL OR node_type = 'note');
CREATE INDEX ix_canvas_nodes_workspace_deleted_at ON canvas_nodes (workspace_id, deleted_at DESC)
    WHERE deleted_at IS NOT NULL;
