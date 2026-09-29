# CollabCanvas prototype

Giao diện nền cho ĐA2: canvas React Flow, StickyNote, TaskCard, dây nối và lưu cục bộ. Giao diện dùng Tailwind CSS và design tokens; có light/dark mode cùng nhãn tiếng Việt/Anh. Nội dung task/ghi chú do người dùng nhập không tự dịch.

## Chạy thử

```bash
npm install
npm run dev
```

Mở địa chỉ Vite hiển thị trong terminal. `npm run build` kiểm tra TypeScript và tạo bản build; `npm run lint` kiểm tra mã nguồn.

Kiểm thử giao diện cần dev server đang chạy. Ở terminal khác:

```bash
npm run test:e2e
```

Mặc định bài test dùng `http://localhost:5173/`; có thể đặt `FRONTEND_URL` nếu server chạy cổng khác. Script ưu tiên Chrome có sẵn trên Windows; máy khác cần cài trình duyệt Playwright bằng `npx playwright install chromium`.

Dữ liệu hiện lưu trong `localStorage` của trình duyệt theo khóa `collabcanvas.prototype.v1`; lựa chọn giao diện/ngôn ngữ lưu riêng. Chưa có tài khoản, API hay PostgreSQL. Khi thêm backend, task cần chuyển sang bảng `tasks`, còn node TaskCard tiếp tục chỉ giữ `taskId`.
