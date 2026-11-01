# Hendy Bot Render

Monorepo Node.js triển khai một dịch vụ trên Render. Express phục vụ REST API và dashboard tĩnh; Telegraf xử lý Telegram Bot; WebSocket cung cấp trạng thái kết nối trực tiếp.

## Cấu trúc

```text
hendy-bot-render/
├── apps/
│   ├── backend-api/
│   │   ├── src/
│   │   │   ├── index.js
│   │   │   ├── database.js
│   │   │   ├── botClient.js
│   │   │   └── botAdmin.js
│   │   └── package.json
│   └── admin-dashboard/
│       ├── index.html
│       ├── build.js
│       └── package.json
├── .github/workflows/ci.yml
├── .env.example
├── package.json
└── render.yaml
```

## Yêu cầu

- Node.js 20 trở lên (Render Blueprint đang chọn Node.js 22).
- PostgreSQL có thể truy cập từ Render.
- Telegram Bot Token được tạo qua BotFather.
- Tài khoản Render đã kết nối repository GitHub.

## Chạy local

1. Cài Node.js.
2. Sao chép `.env.example` thành `.env`.
3. Điền `BOT_TOKEN`, `ADMIN_ID` và `DATABASE_URL`. Khi chạy local, đặt `DATABASE_SSL=false` nếu PostgreSQL local không dùng TLS.
4. Cài dependency và build dashboard:

   ```bash
   npm install
   npm run build
   ```

5. Khởi động:

   ```bash
   npm start
   ```

Khi không có `RENDER_EXTERNAL_URL`, bot dùng long polling. Trên Render, ứng dụng tự đăng ký Telegram webhook tại `/webhook/telegram`.

## Triển khai lên Render

1. Trên Render, chọn **New → Blueprint**.
2. Kết nối repository `hendyngo-servers/hendy-bot-render` và chọn nhánh `main`.
3. Render đọc cấu hình từ `render.yaml`, cài dependency, build dashboard và khởi chạy Express.
4. Khai báo các biến bắt buộc khi Render yêu cầu:
   - `BOT_TOKEN`: token Telegram Bot mới.
   - `ADMIN_ID`: Telegram user ID dạng số.
   - `DATABASE_URL`: PostgreSQL connection string.
5. Khai báo các biến tùy chọn theo chức năng: `WEBAPP_URL`, `ALLOWED_ORIGINS`, `TELEGRAM_WEBHOOK_SECRET`, `BANK_WEBHOOK_SECRET`, các biến VietQR và URL nhóm/kênh.
6. Sau deploy, kiểm tra `https://<ten-dich-vu>.onrender.com/healthz` và mở trang chủ để xem dashboard.

Render tự cung cấp `RENDER_EXTERNAL_URL` và Blueprint tự ánh xạ URL này sang `WEBAPP_URL`. Hãy tạo `TELEGRAM_WEBHOOK_SECRET` bằng `openssl rand -hex 32` rồi nhập vào Render khi tạo Blueprint; `BANK_WEBHOOK_SECRET` được Render tự tạo. Gửi cùng giá trị `BANK_WEBHOOK_SECRET` vào cấu hình header `x-bank-webhook-secret` của nhà cung cấp webhook ngân hàng.

## Biến môi trường

| Biến | Bắt buộc | Mục đích |
|---|---:|---|
| `BOT_TOKEN` | Có | Token Telegram Bot |
| `ADMIN_ID` | Có | Telegram user ID được cấp quyền admin |
| `DATABASE_URL` | Có | Kết nối PostgreSQL |
| `DATABASE_SSL` | Không | Mặc định bật TLS; đặt `false` cho PostgreSQL local |
| `RENDER_EXTERNAL_URL` | Render tự cấp | Kích hoạt webhook Telegram |
| `WEBAPP_URL` | Không | URL mở dashboard từ menu bot; mặc định dùng URL dịch vụ Render |
| `ALLOWED_ORIGINS` | Không | Danh sách origin được phép gọi API/WS, phân tách bằng dấu phẩy |
| `TELEGRAM_WEBHOOK_SECRET` | Có trên Render | Xác thực request webhook Telegram |
| `BANK_WEBHOOK_SECRET` | Có để nhận webhook ngân hàng | Header `x-bank-webhook-secret`; endpoint từ chối request nếu chưa cấu hình |
| `VIETQR_BANK_ID` | Không | Mã ngân hàng VietQR |
| `VIETQR_ACCOUNT_NO` | Không | Số tài khoản nhận tiền |
| `VIETQR_ACCOUNT_NAME` | Không | Tên chủ tài khoản hiển thị trên QR |
| `GROUP_URL`, `CHANNEL_URL` | Không | Liên kết nhóm và kênh Telegram |

Tạo secret ngẫu nhiên bằng lệnh `openssl rand -hex 32`. Không gửi secret qua chat, không ghi vào source code và không commit file `.env`.

## Endpoint

- `GET /healthz`: health check dành cho Render.
- `GET /api/health`: trạng thái ứng dụng và kết nối database, không trả về thông tin bí mật.
- `POST /webhook/telegram`: Telegram webhook; được kiểm tra secret token khi đã cấu hình.
- `POST /webhook/bank`: webhook nạp tiền; bắt buộc có header `x-bank-webhook-secret`.
- `GET /ws`: WebSocket trạng thái dashboard.
- `/`: dashboard vận hành tiếng Việt.

Webhook ngân hàng hiện chỉ chấp nhận nội dung chuyển khoản chính xác theo mẫu `NAP <TELEGRAM_USER_ID>`, số tiền VND nguyên dương và mã tham chiếu giao dịch. Mã tham chiếu được lưu duy nhất để chống cộng tiền lặp. Cần cấu hình secret ở cả phía nhà cung cấp webhook và Render.

## Database

Ứng dụng tự tạo các bảng `users`, `transactions` và `deposit_events` khi khởi động. `deposit_events.reference_code` có khóa chính để bảo đảm một mã giao dịch không được xử lý hai lần.

## Kiểm tra mã nguồn

```bash
npm run check
npm run build
```

GitHub Actions chạy hai lệnh này khi push hoặc mở pull request.

## Lưu ý bảo mật quan trọng

Repository trước đây từng có file mẫu chứa chuỗi trông giống thông tin xác thực thật. Hãy thu hồi token Telegram cũ, tạo token mới qua BotFather, đổi mật khẩu/credential PostgreSQL và cập nhật các secret trên Render. Việc sửa file ở commit mới không xóa bí mật khỏi lịch sử Git; cần xử lý lịch sử repository riêng nếu bí mật đã từng được commit.
