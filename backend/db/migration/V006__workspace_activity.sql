CREATE TABLE activity_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_user_id uuid NOT NULL REFERENCES users(id),
    task_id uuid NOT NULL,
    task_title varchar(200) NOT NULL,
    action varchar(32) NOT NULL,
    from_status varchar(20),
    to_status varchar(20),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_activity_events_action CHECK (action IN (
        'task_created', 'task_updated', 'task_status_changed',
        'task_assignees_changed', 'checklist_changed',
        'task_trashed', 'task_restored'
    ))
);

CREATE INDEX ix_activity_events_workspace_time ON activity_events (workspace_id, created_at DESC, id DESC);
CREATE INDEX ix_activity_events_workspace_task_time ON activity_events (workspace_id, task_id, created_at DESC, id DESC);
