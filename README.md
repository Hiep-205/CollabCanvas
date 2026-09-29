# CollabCanvas

CollabCanvas gồm hai ứng dụng độc lập:

- `frontend/`: React, Vite, TypeScript và React Flow. Prototype hiện lưu dữ liệu trong trình duyệt.
- `backend/`: NestJS, TypeScript và cấu hình Prisma cho PostgreSQL. Các module nghiệp vụ hiện là khung; chưa có API auth, workspace, task hoặc canvas.

## Cấu trúc

```text
frontend/src/app/         Khởi tạo frontend
frontend/src/pages/       Màn hình workspace
frontend/src/features/    Canvas và task của prototype
frontend/src/styles/      CSS chung
backend/src/modules/      Auth, users, workspaces, tasks, canvas
backend/src/common/       Thành phần dùng chung của API
backend/src/infra/prisma/ Kết nối Prisma trong giai đoạn triển khai dữ liệu
backend/prisma/           Schema và migrations
docs/                     Quyết định kiến trúc
compose.yaml              PostgreSQL cho môi trường local
```

Mỗi ứng dụng có `package.json` và `package-lock.json` riêng. Không cài dependency ở thư mục gốc.

## Chạy hiện tại

Yêu cầu Node.js 24 và npm.

```bash
cd frontend
npm install
npm run dev
```

```bash
cd backend
npm install
npm run dev
```

Frontend chạy tại `http://localhost:5173`, backend tại `http://localhost:3000/api/health`. PostgreSQL được khai báo trong `compose.yaml`; backend chưa kết nối CSDL khi khởi động. Xem `docs/architecture.md` trước khi bổ sung API nghiệp vụ.

Để kiểm tra/lên schema Prisma sau này, tạo `backend/.env` từ `backend/.env.example` và khởi chạy PostgreSQL bằng `docker compose up -d`. Chưa có bảng hay migration nghiệp vụ.
