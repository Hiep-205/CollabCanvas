ALTER TABLE canvas_nodes
    DROP CONSTRAINT uq_canvas_nodes_workspace_task_id,
    DROP CONSTRAINT ck_canvas_nodes_shape;

ALTER TABLE canvas_nodes
    ADD CONSTRAINT ck_canvas_nodes_shape CHECK (
        (node_type = 'task' AND task_id IS NOT NULL AND note_text IS NULL AND note_color IS NULL)
        OR (node_type = 'note' AND note_text IS NOT NULL AND note_color IN ('yellow', 'green', 'pink') AND NOT is_hidden)
    );

CREATE UNIQUE INDEX uq_canvas_nodes_workspace_task_id
    ON canvas_nodes (workspace_id, task_id)
    WHERE node_type = 'task';

CREATE INDEX ix_canvas_nodes_workspace_note_task
    ON canvas_nodes (workspace_id, task_id)
    WHERE node_type = 'note' AND task_id IS NOT NULL;
