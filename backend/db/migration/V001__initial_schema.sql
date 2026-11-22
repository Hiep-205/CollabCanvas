CREATE TABLE users (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    email varchar(320) NOT NULL,
    password_hash text NOT NULL,
    display_name varchar(120) NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT ck_users_email_normalized CHECK (email = lower(btrim(email)) AND email <> ''),
    CONSTRAINT ck_users_display_name CHECK (btrim(display_name) <> ''),
    CONSTRAINT ck_users_password_hash CHECK (password_hash <> '')
);

CREATE TABLE user_sessions (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    refresh_token_hash varchar(128) NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_user_sessions PRIMARY KEY (id),
    CONSTRAINT uq_user_sessions_refresh_token_hash UNIQUE (refresh_token_hash),
    CONSTRAINT fk_user_sessions_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_user_sessions_expires_at CHECK (expires_at > created_at)
);
CREATE INDEX ix_user_sessions_user_id_expires_at ON user_sessions (user_id, expires_at);

CREATE TABLE workspaces (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name varchar(120) NOT NULL,
    description text,
    canvas_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_workspaces PRIMARY KEY (id),
    CONSTRAINT ck_workspaces_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_workspaces_canvas_version CHECK (canvas_version > 0)
);

CREATE TABLE workspace_members (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role varchar(16) NOT NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_workspace_members PRIMARY KEY (workspace_id, user_id),
    CONSTRAINT fk_workspace_members_workspace_id FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
    CONSTRAINT fk_workspace_members_user_id FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT ck_workspace_members_role CHECK (role IN ('owner', 'editor', 'viewer'))
);
CREATE UNIQUE INDEX uq_workspace_members_one_owner ON workspace_members (workspace_id) WHERE role = 'owner';
CREATE INDEX ix_workspace_members_user_id ON workspace_members (user_id, workspace_id);

CREATE TABLE workspace_invitations (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    invitee_user_id uuid NOT NULL,
    inviter_user_id uuid NOT NULL,
    role varchar(16) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    expires_at timestamptz NOT NULL,
    responded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_workspace_invitations PRIMARY KEY (id),
    CONSTRAINT fk_workspace_invitations_workspace_id FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
    CONSTRAINT fk_workspace_invitations_invitee_user_id FOREIGN KEY (invitee_user_id) REFERENCES users (id),
    CONSTRAINT fk_workspace_invitations_inviter_user_id FOREIGN KEY (inviter_user_id) REFERENCES users (id),
    CONSTRAINT ck_workspace_invitations_role CHECK (role IN ('editor', 'viewer')),
    CONSTRAINT ck_workspace_invitations_status CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
    CONSTRAINT ck_workspace_invitations_expires_at CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX uq_workspace_invitations_pending ON workspace_invitations (workspace_id, invitee_user_id) WHERE status = 'pending';
CREATE INDEX ix_workspace_invitations_invitee_status ON workspace_invitations (invitee_user_id, status, expires_at);

CREATE TABLE tasks (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    title varchar(200) NOT NULL,
    description text,
    status varchar(20) NOT NULL DEFAULT 'todo',
    priority varchar(12) NOT NULL DEFAULT 'normal',
    due_at timestamptz,
    sort_order bigint NOT NULL DEFAULT 0,
    version bigint NOT NULL DEFAULT 1,
    created_by_user_id uuid NOT NULL,
    updated_by_user_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_tasks PRIMARY KEY (id),
    CONSTRAINT uq_tasks_workspace_id_id UNIQUE (workspace_id, id),
    CONSTRAINT fk_tasks_workspace_id FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
    CONSTRAINT fk_tasks_created_by_user_id FOREIGN KEY (created_by_user_id) REFERENCES users (id),
    CONSTRAINT fk_tasks_updated_by_user_id FOREIGN KEY (updated_by_user_id) REFERENCES users (id),
    CONSTRAINT ck_tasks_title CHECK (btrim(title) <> ''),
    CONSTRAINT ck_tasks_status CHECK (status IN ('todo', 'in_progress', 'done')),
    CONSTRAINT ck_tasks_priority CHECK (priority IN ('low', 'normal', 'high')),
    CONSTRAINT ck_tasks_sort_order CHECK (sort_order >= 0),
    CONSTRAINT ck_tasks_version CHECK (version > 0)
);
CREATE INDEX ix_tasks_workspace_status_sort_order ON tasks (workspace_id, status, sort_order, id);
CREATE INDEX ix_tasks_workspace_due_at ON tasks (workspace_id, due_at) WHERE status <> 'done' AND due_at IS NOT NULL;

CREATE TABLE task_assignees (
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    assigned_by_user_id uuid NOT NULL,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_task_assignees PRIMARY KEY (workspace_id, task_id, user_id),
    CONSTRAINT fk_task_assignees_task FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_task_assignees_member FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE,
    CONSTRAINT fk_task_assignees_assigned_by_user_id FOREIGN KEY (assigned_by_user_id) REFERENCES users (id)
);
CREATE INDEX ix_task_assignees_workspace_user_id ON task_assignees (workspace_id, user_id, task_id);

CREATE TABLE canvas_nodes (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    node_type varchar(8) NOT NULL,
    task_id uuid,
    note_text text,
    note_color varchar(8),
    position_x numeric(12, 2) NOT NULL,
    position_y numeric(12, 2) NOT NULL,
    is_hidden boolean NOT NULL DEFAULT false,
    version bigint NOT NULL DEFAULT 1,
    created_by_user_id uuid NOT NULL,
    updated_by_user_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_canvas_nodes PRIMARY KEY (id),
    CONSTRAINT uq_canvas_nodes_workspace_id_id UNIQUE (workspace_id, id),
    CONSTRAINT uq_canvas_nodes_workspace_task_id UNIQUE (workspace_id, task_id),
    CONSTRAINT fk_canvas_nodes_workspace_id FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
    CONSTRAINT fk_canvas_nodes_task FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_canvas_nodes_created_by_user_id FOREIGN KEY (created_by_user_id) REFERENCES users (id),
    CONSTRAINT fk_canvas_nodes_updated_by_user_id FOREIGN KEY (updated_by_user_id) REFERENCES users (id),
    CONSTRAINT ck_canvas_nodes_shape CHECK (
        (node_type = 'task' AND task_id IS NOT NULL AND note_text IS NULL AND note_color IS NULL)
        OR (node_type = 'note' AND task_id IS NULL AND note_text IS NOT NULL AND note_color IN ('yellow', 'green', 'pink') AND NOT is_hidden)
    ),
    CONSTRAINT ck_canvas_nodes_version CHECK (version > 0)
);
CREATE INDEX ix_canvas_nodes_workspace_type ON canvas_nodes (workspace_id, node_type, is_hidden);

CREATE TABLE canvas_associations (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    node_a_id uuid NOT NULL,
    node_b_id uuid NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_canvas_associations PRIMARY KEY (id),
    CONSTRAINT uq_canvas_associations_nodes UNIQUE (workspace_id, node_a_id, node_b_id),
    CONSTRAINT fk_canvas_associations_node_a FOREIGN KEY (workspace_id, node_a_id) REFERENCES canvas_nodes (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_canvas_associations_node_b FOREIGN KEY (workspace_id, node_b_id) REFERENCES canvas_nodes (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_canvas_associations_created_by_user_id FOREIGN KEY (created_by_user_id) REFERENCES users (id),
    CONSTRAINT ck_canvas_associations_node_order CHECK (node_a_id < node_b_id)
);
CREATE INDEX ix_canvas_associations_node_b ON canvas_associations (workspace_id, node_b_id);

CREATE TABLE task_dependencies (
    workspace_id uuid NOT NULL,
    prerequisite_task_id uuid NOT NULL,
    dependent_task_id uuid NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_task_dependencies PRIMARY KEY (workspace_id, prerequisite_task_id, dependent_task_id),
    CONSTRAINT fk_task_dependencies_prerequisite FOREIGN KEY (workspace_id, prerequisite_task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_task_dependencies_dependent FOREIGN KEY (workspace_id, dependent_task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_task_dependencies_created_by_user_id FOREIGN KEY (created_by_user_id) REFERENCES users (id),
    CONSTRAINT ck_task_dependencies_distinct CHECK (prerequisite_task_id <> dependent_task_id)
);
CREATE INDEX ix_task_dependencies_dependent ON task_dependencies (workspace_id, dependent_task_id);

CREATE TABLE attachments (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    task_id uuid,
    note_node_id uuid,
    original_name varchar(255) NOT NULL,
    mime_type varchar(255) NOT NULL,
    size_bytes bigint NOT NULL,
    storage_key text NOT NULL,
    uploaded_by_user_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_attachments PRIMARY KEY (id),
    CONSTRAINT uq_attachments_storage_key UNIQUE (storage_key),
    CONSTRAINT fk_attachments_workspace_id FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
    CONSTRAINT fk_attachments_task FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_attachments_note_node FOREIGN KEY (workspace_id, note_node_id) REFERENCES canvas_nodes (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_attachments_uploaded_by_user_id FOREIGN KEY (uploaded_by_user_id) REFERENCES users (id),
    CONSTRAINT ck_attachments_one_parent CHECK ((task_id IS NULL) <> (note_node_id IS NULL)),
    CONSTRAINT ck_attachments_size_bytes CHECK (size_bytes > 0),
    CONSTRAINT ck_attachments_original_name CHECK (btrim(original_name) <> ''),
    CONSTRAINT ck_attachments_storage_key CHECK (storage_key <> '')
);
CREATE INDEX ix_attachments_workspace_task ON attachments (workspace_id, task_id) WHERE task_id IS NOT NULL;
CREATE INDEX ix_attachments_workspace_note ON attachments (workspace_id, note_node_id) WHERE note_node_id IS NOT NULL;
