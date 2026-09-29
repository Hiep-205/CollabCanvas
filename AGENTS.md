# Quy tắc làm việc - CollabCanvas

Tài liệu này là quy tắc bắt buộc khi phát triển CollabCanvas. Áp dụng cho mã mới và phần mã được chỉnh sửa. Prototype hiện tại chưa đáp ứng toàn bộ quy tắc; các phần cũ được chuyển đổi dần khi triển khai tính năng tương ứng, không coi là đã hoàn thành chỉ vì đã có giao diện.

## 1. Phạm vi và kiến trúc

- `frontend/` và `backend/` là hai dự án độc lập, mỗi dự án quản lý dependency riêng. Frontend gọi API, không truy cập PostgreSQL trực tiếp.
- Backend NestJS sở hữu nghiệp vụ, xác thực, phân quyền và dữ liệu. Mã của một tính năng nằm trong module/feature của tính năng đó. Chỉ đưa mã vào `shared/` hoặc `common/` khi có nhu cầu dùng chung thực tế.
- MVP gồm đăng nhập, workspace, chia sẻ theo tài khoản, task/Kanban và canvas có liên kết task. Không thêm tính năng ngoài phạm vi chỉ để tăng số lượng tính năng.
- Realtime nhiều người cùng chỉnh sửa là hướng phát triển sau MVP. Không gọi cơ chế tự lưu hiện tại là realtime.

## 2. Giao diện và trải nghiệm

- Hướng thiết kế đã chốt: Soft UI / Glassmorphism / Vibrant Neo-Minimalism. Giao diện thân thiện, mềm mại, có chiều sâu và màu sắc sống động nhưng không chói. Tránh bố cục AI đại trà, góc sắc, viền cứng, chữ đen thuần (`#000`) và trang trí làm loãng nội dung. Prototype hiện tại không phải chuẩn thị giác cuối cùng.
- Chia giao diện thành hai lớp thị giác. **Khung ứng dụng** (topbar, điều hướng, sidebar, modal) mang phong cách kính mờ và màu sắc mềm; **vùng làm việc** (canvas, Kanban, thẻ task, ghi chú và control chỉnh sửa) ưu tiên nền ổn định, chữ rõ, trạng thái dễ phân biệt. Hai lớp dùng chung typography, tokens và nhịp khoảng cách để vẫn là một sản phẩm thống nhất.
- Gradient pastel rất nhẹ, phối các sắc như peach, xanh nhạt và hồng, chỉ làm nền cho khung ứng dụng hoặc vùng trống; không đặt gradient chuyển động dưới canvas hay bảng nhiều dữ liệu. Dùng semantic tokens cho nền, chữ, bề mặt và điểm nhấn; không rải màu cố định trong component. Chuẩn bị các accent gradient có vai trò rõ ràng: `vibrant-green` (xanh lá - vàng), `vibrant-blue` (xanh nhạt - teal), `vibrant-coral` (coral - cam), `vibrant-purple` (tím - hồng). Mỗi màn hình chỉ dùng số ít accent có chủ đích; gradient không thay thế màu trạng thái nghiệp vụ.
- Card trang trí hoặc modal lớn trong khung ứng dụng có thể bo khoảng 24px; nút và input bo mềm hoặc dạng pill khi phù hợp. Thẻ kéo thả, task card, sticky note và control dày thông tin dùng góc bo gọn hơn (ưu tiên khoảng 6-8px), kích thước ổn định và khoảng cách vừa đủ để quét nhanh. Dùng thang khoảng cách 8px; không lồng card trong card để tạo chiều sâu giả.
- Topbar/sidebar và các bề mặt nổi có thể bán trong suốt, dùng `backdrop-blur`, bóng đổ nhiều lớp và điểm sáng bên trong thật nhẹ. Canvas, cột Kanban, thẻ task và vùng nhập liệu dùng nền gần như đặc, bóng đổ tiết chế, không blur nội dung phía sau. Giảm blur/gradient nếu ảnh hưởng khả năng đọc, hiệu năng hoặc tương phản ở light/dark mode.
- Trong vùng làm việc, phân biệt loại node và trạng thái task bằng nhãn, biểu tượng hoặc viền màu có kiểm soát; không chỉ dựa vào màu. Node được chọn, đang kéo, có lỗi lưu hoặc bị khóa quyền phải có trạng thái riêng, không làm thay đổi kích thước gây xô lệch bố cục. Điểm nối và vùng kéo phải dễ nhận ra mà không che nội dung.
- Item điều hướng đang chọn có thể dùng nền màu/kính mờ mềm; item trên canvas/Kanban dùng viền hoặc dấu nhấn rõ hơn. Hover có chuyển động, thay đổi độ sáng hoặc glow tinh tế nhưng không cản thao tác kéo thả; focus phải nhìn rõ bằng bàn phím. Tôn trọng thiết lập giảm chuyển động của hệ điều hành.
- Ưu tiên icon trong thư viện hiện có; có thể dùng màu hoặc glow nhẹ để nhấn vai trò. Avatar tròn, viền màu có kiểm soát. Mock data phải sạch, tích cực và gần với bối cảnh sử dụng thực tế.
- Khi triển khai lại UI, viết React + TypeScript và dùng Tailwind utility classes cùng hệ token thống nhất; không trộn tùy tiện nhiều cách styling cho cùng một thành phần. Chưa thêm Tailwind hay thay toàn bộ CSS chỉ để cập nhật bộ rule này.
- `image_0.png` được nhắc tới trong brief nhưng chưa có trong repo. Bộ mô tả bằng chữ là căn cứ hiện tại; cần xem ảnh trước khi nhận nhiệm vụ bám sát ảnh tham chiếu.
- Hỗ trợ light mode và dark mode bằng semantic color tokens. Kiểm tra độ tương phản, trạng thái hover/focus/disabled/error và khả năng đọc ở cả hai chế độ.
- Ưu tiên desktop/laptop. Màn hình nhỏ vẫn phải dùng được, không có chữ, control hoặc panel chồng lấn vô nghĩa.
- Toàn bộ nội dung giao diện mới dùng hệ thống i18n tiếng Việt và tiếng Anh; không rải chuỗi hiển thị trực tiếp trong component. Hai bản dịch phải diễn đạt tự nhiên và nhất quán.
- Ưu tiên thao tác rõ ràng, phản hồi trạng thái và điều hướng nhất quán hơn hiệu ứng trang trí. Control tương tác phải dùng được bằng bàn phím và có nhãn dễ hiểu.

## 3. Quy ước đặt tên

- TypeScript: biến, hàm, method và hook dùng `camelCase`; component, class, type và interface dùng `PascalCase`; hằng số bất biến toàn cục dùng `UPPER_SNAKE_CASE`. Tên mô tả đúng ý nghĩa, tránh viết tắt khó hiểu.
- PostgreSQL: tên bảng số nhiều và `snake_case` (`users`, `workspace_members`); tên cột, khóa ngoại, index và constraint dùng `snake_case` (`workspace_id`, `created_at`). Giữ một quy ước xuyên suốt schema và migration.
- Nếu model/field trong Prisma dùng cách đặt tên phù hợp TypeScript, khai báo mapping tường minh tới tên bảng/cột trong PostgreSQL; không để tên DB phụ thuộc ngẫu nhiên vào tên model.
- REST API dùng danh từ số nhiều, chữ thường và dấu gạch nối khi cần, ví dụ `/workspaces/:id/tasks`. Không đặt endpoint theo động từ như `/getTasks`.

## 4. Dữ liệu, API và bảo mật

- Mọi thay đổi schema phải có migration được lưu trong repo. Không sửa DB thủ công để tạo trạng thái khác schema/migration.
- Backend kiểm tra và chuẩn hóa dữ liệu đầu vào; trả lỗi có cấu trúc nhất quán. Không trả thông tin nội bộ, mật khẩu, token hoặc connection string trong response/log.
- MVP đăng nhập bằng email và mật khẩu. Không lưu mật khẩu dạng gốc; không commit secret, `.env` thật hoặc dữ liệu nhạy cảm. Dùng biến môi trường cho cấu hình nhạy cảm.
- Khi tạo hoặc gặp một loại file chứa secret mới (token, khóa riêng, credential, bản sao dữ liệu thật), thêm mẫu tên/path phù hợp vào `.gitignore` gốc **trước khi tạo hoặc stage file đó**. Chỉ commit file mẫu như `.env.example` với giá trị giả/placeholder; không đưa secret thật vào file mẫu, mã nguồn, test fixture hay tài liệu.
- Trước mỗi commit, kiểm tra `git status` và `git diff --cached`; với file nhạy cảm mới, xác nhận quy tắc bằng `git check-ignore -v <path>`. Không dựa vào `.gitignore` như công cụ quét nội dung: file đã được Git theo dõi vẫn có thể bị commit. Nếu phát hiện secret đã được stage/commit, dừng lại để xử lý và thay secret đó; chỉ thêm ignore không xóa được secret khỏi lịch sử Git.
- Workspace mặc định riêng tư. Owner chỉ mời tài khoản cụ thể; MVP không có link truy cập công khai.
- Quyền tối thiểu: `owner` quản lý workspace, thành viên và quyền chia sẻ; `editor` chỉnh sửa nội dung; `viewer` chỉ xem. Owner cũng có quyền chỉnh sửa nội dung. Backend phải kiểm tra quyền và quan hệ với workspace ở từng endpoint liên quan; việc ẩn nút ở frontend không thay thế kiểm tra này.
- Truy vấn dữ liệu phải giới hạn theo workspace mà người dùng được phép truy cập. Kiểm thử trường hợp người dùng cố truy cập ID thuộc workspace khác.

## 5. Tự lưu và xung đột

- Thay đổi nội dung được tự lưu. Giao diện cho biết trạng thái `đang lưu`, `đã lưu` và `lưu lỗi`; không báo đã lưu trước khi server xác nhận.
- Lỗi mạng không được làm mất nội dung người dùng đang chỉnh sửa; có cách thử lưu lại.
- Khi dữ liệu trên server đã đổi từ lúc client tải về, API phải phát hiện xung đột bằng phiên bản dữ liệu hoặc cơ chế tương đương. Không âm thầm ghi đè thay đổi của người khác.
- Việc đồng bộ tức thời giữa nhiều người cần thiết kế riêng khi triển khai realtime; không giả định tự lưu sẽ tự giải quyết xung đột.

## 6. Quy trình thực hiện một task

1. Viết mục tiêu, phạm vi và tiêu chí chấp nhận. Kiểm tra mã hiện có trước khi sửa.
2. Nếu task ảnh hưởng dữ liệu hoặc giao tiếp frontend/backend, chốt schema, migration, API và quyền truy cập trước khi triển khai UI.
3. Code đúng module/feature; không trộn refactor không liên quan vào cùng task.
4. Kiểm thử luồng chính, trường hợp lỗi và trường hợp không có quyền. Cập nhật tài liệu nếu API, schema, kiến trúc hoặc cách chạy thay đổi.
5. Chỉ đánh dấu hoàn thành khi các điều kiện ở mục 7 đạt; sau đó commit thay đổi có ý nghĩa.

Một người phát triển vẫn dùng branch riêng cho thay đổi đáng kể. Commit nhỏ, rõ nội dung, theo tiền tố `feat:`, `fix:`, `docs:`, `test:` hoặc `refactor:`. Không bắt buộc tạo pull request cho chính mình.

## 7. Điều kiện hoàn thành

- Build, typecheck, lint và test liên quan phải đạt. Nếu repo chưa có lệnh lint/test phù hợp, thiết lập chúng trước khi coi tính năng mới là hoàn thành; không ghi “đã test” khi chưa chạy.
- Kiểm tra thủ công luồng người dùng bị ảnh hưởng, gồm trạng thái loading, empty, error và quyền truy cập khi có liên quan. Với thay đổi UI, kiểm tra tiếng Việt/Anh, light/dark và kích thước desktop/laptop; kiểm tra màn hình nhỏ để tránh vỡ bố cục.
- Tính năng liên quan auth, phân quyền, tự lưu hoặc liên kết task giữa Kanban và canvas phải có test tập trung cho hành vi quan trọng. Không đặt chỉ tiêu phần trăm coverage tùy tiện.
- Không có secret trong commit; `.gitignore` đã bao phủ loại file nhạy cảm mới và `git status`/staged diff đã được kiểm tra. Migration và tài liệu liên quan được cập nhật. Ghi rõ phần nào vẫn là prototype, chưa có backend hoặc chưa được kiểm chứng.
