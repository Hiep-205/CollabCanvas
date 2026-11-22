-- ============================================================================
-- Migration: V007__task_comments.sql
-- Description: In-context Discussion Threads, @mentions, and Unread Notifications
-- Project: CollabCanvas
-- Author: Engineering Team
-- ============================================================================

-- 1. Bảng lưu trữ bình luận theo ngữ cảnh công việc (Hỗ trợ phân cấp luồng - Threaded Comments)
CREATE TABLE task_comments (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    author_user_id uuid NOT NULL,
    parent_comment_id uuid,
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,

    -- Ràng buộc Khóa chính
    CONSTRAINT pk_task_comments PRIMARY KEY (id),

    -- Ràng buộc Unique phức hợp phục vụ toàn vẹn cô lập đa người thuê (Multi-Tenancy Invariant)
    CONSTRAINT uq_task_comments_workspace_id_id UNIQUE (workspace_id, id),
    CONSTRAINT uq_task_comments_workspace_task_id UNIQUE (workspace_id, task_id, id),

    -- Khóa ngoại đảm bảo tính toàn vẹn Workspace đa người thuê (Multi-Tenancy)
    CONSTRAINT fk_task_comments_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces (id) ON DELETE CASCADE,

    -- Khóa ngoại phức hợp liên kết trực tiếp tới Task thuộc đúng Workspace
    CONSTRAINT fk_task_comments_task FOREIGN KEY (workspace_id, task_id)
        REFERENCES tasks (workspace_id, id) ON DELETE CASCADE,

    -- Khóa ngoại liên kết tới Tác giả bình luận
    CONSTRAINT fk_task_comments_author FOREIGN KEY (author_user_id)
        REFERENCES users (id),

    -- Khóa ngoại tự tham chiếu hỗ trợ luồng thảo luận con (Thread replies) cô lập trong cùng Task & Workspace
    CONSTRAINT fk_task_comments_parent FOREIGN KEY (workspace_id, task_id, parent_comment_id)
        REFERENCES task_comments (workspace_id, task_id, id) ON DELETE CASCADE,

    -- Ràng buộc kiểm tra độ dài nội dung (từ 1 đến 5000 ký tự hợp lệ, không chấp nhận khoảng trắng rỗng)
    CONSTRAINT ck_task_comments_content CHECK (
        length(btrim(content)) > 0 AND length(content) <= 5000
    )
);

-- 2. Bảng quản lý việc đề cập thành viên (@mentions) và trạng thái đọc thông báo
CREATE TABLE comment_mentions (
    comment_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    mentioned_user_id uuid NOT NULL,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),

    -- Khóa chính phức hợp ngăn ngừa trùng lặp lượt mention trong cùng một bình luận
    CONSTRAINT pk_comment_mentions PRIMARY KEY (comment_id, mentioned_user_id),

    -- Ràng buộc Khóa ngoại phức hợp tới task_comments đảm bảo cô lập đa người thuê
    CONSTRAINT fk_comment_mentions_task_comment FOREIGN KEY (workspace_id, comment_id)
        REFERENCES task_comments (workspace_id, id) ON DELETE CASCADE,

    CONSTRAINT fk_comment_mentions_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces (id) ON DELETE CASCADE,

    -- Ràng buộc Khóa ngoại phức hợp tới workspace_members đảm bảo người được mention phải là thành viên hợp lệ của Workspace
    CONSTRAINT fk_comment_mentions_member FOREIGN KEY (workspace_id, mentioned_user_id)
        REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE
);

-- 3. Thiết lập các Chỉ mục (Indexes) tối ưu hóa truy vấn thời gian thực
-- Chỉ mục tải nhanh danh sách bình luận còn hiệu lực của một Task theo trình tự thời gian tăng dần
CREATE INDEX ix_task_comments_task_time
    ON task_comments (workspace_id, task_id, created_at ASC)
    WHERE deleted_at IS NULL;

-- Chỉ mục hỗ trợ gom nhóm luồng thảo luận con theo bình luận cha
CREATE INDEX ix_task_comments_parent
    ON task_comments (parent_comment_id)
    WHERE parent_comment_id IS NOT NULL AND deleted_at IS NULL;

-- Chỉ mục phục vụ quản trị dọn dẹp hoặc phục hồi bình luận đã xóa mềm
CREATE INDEX ix_task_comments_workspace_deleted
    ON task_comments (workspace_id, deleted_at DESC)
    WHERE deleted_at IS NOT NULL;

-- Chỉ mục một phần (Partial Index) cực nhanh phục vụ đếm và lấy thông báo chưa đọc của người dùng
CREATE INDEX ix_comment_mentions_user_unread
    ON comment_mentions (mentioned_user_id, is_read, created_at DESC)
    WHERE NOT is_read;
