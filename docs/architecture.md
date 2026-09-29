# Kiến trúc Đồ án 2

## Ranh giới ứng dụng

`frontend/` và `backend/` là hai dự án độc lập. Frontend gọi REST API; backend sở hữu quy tắc nghiệp vụ, phân quyền và PostgreSQL. Trong giai đoạn ĐA2 không có gateway realtime.

```text
React + React Flow  -- REST /api -->  NestJS modules  -->  Prisma  -->  PostgreSQL
```

## Backend

Backend là một ứng dụng NestJS theo module. Controller nhận request, service xử lý nghiệp vụ, Prisma truy cập dữ liệu. `common/` chỉ chứa cơ chế dùng chung như guard và xử lý lỗi; mã của từng tính năng ở trong module tương ứng.

| Module | Trách nhiệm |
| --- | --- |
| `auth` | Đăng ký, đăng nhập, phiên làm việc. |
| `users` | Thông tin người dùng. |
| `workspaces` | Workspace, thành viên và quyền truy cập. |
| `tasks` | CRUD task, trạng thái và thứ tự Kanban. |
| `canvas` | Tải/lưu tài liệu canvas và kiểm tra phiên bản. |

`prisma/schema.prisma` là nơi định nghĩa mô hình dữ liệu. Migration sẽ được tạo khi chốt schema và có PostgreSQL chạy. Backend hiện chỉ có `GET /api/health`; các module nghiệp vụ chưa cung cấp endpoint.

## Frontend

Frontend hiện được chia theo `app/` (khởi tạo ứng dụng), `pages/` (màn hình workspace), `features/canvas/` (node và lưu canvas cục bộ), `features/tasks/` (kiểu dữ liệu và nhãn task), `styles/` (CSS). Chưa tạo `shared/`, `features/auth/`, `features/workspaces/` hoặc `features/kanban/` vì chưa có mã tương ứng.

Khi triển khai API, `features/tasks` sẽ sở hữu thao tác với task; Canvas và Kanban cùng dùng task từ API/cache. TaskCard trên canvas chỉ giữ `taskId`. Trong prototype, dữ liệu vẫn nằm ở `localStorage` cho đến khi API và database hoàn thành.

## Hướng mở rộng

Khi làm ĐATN, gateway Yjs/WebSocket có thể thành một ứng dụng riêng. Nó không nằm trong phạm vi khung ĐA2 này.
