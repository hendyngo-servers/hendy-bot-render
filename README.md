# Hendy Bot Render

Monorepo Node.js triển khai trên Render: Express + PostgreSQL + Dashboard + một hoặc hai Telegram Bot bằng grammY + WebSocket realtime.

## Cấu trúc

```text
hendy-bot-render/
├── apps/
│   ├── backend-api/src/
│   │   ├── index.js                  # Express, hai grammY bot, webhook và WebSocket
│   │   ├── botClient.js              # Reply Keyboard / Inline Keyboard và nghiệp vụ
│   │   ├── botAdmin.js               # Lệnh quản trị Telegram
│   │   ├── api.js                    # REST API và cấu hình menu theo bot
│   │   ├── database.js               # PostgreSQL schema/migrations
│   │   ├── telegramAuth.js           # Xác thực Mini App theo từng bot
│   │   ├── ui/buttonTheme.js         # Helper màu nút grammY
│   │   └── features/registry.js      # Registry feature allowlist
│   └── admin-dashboard/
│       ├── index.html
│       ├── styles/buttons.css
│       └── build.js
├── scripts/scaffold-feature.js
├── .github/workflows/
│   ├── ci.yml
│   └── scaffold-feature.yml
├── package.json
└── render.yaml
```

## Hai kiểu menu Telegram

Vào Admin → Menu & Bot để chỉnh riêng từng bot.

- Reply Keyboard: lưới nút thay bàn phím hệ thống, nằm cố định phía dưới ô nhập. Hỗ trợ 1–3 cột, persistent và resize.
- Inline Keyboard: nút nằm dưới tin nhắn, phù hợp với các thao tác xác nhận, mở URL/WebApp và menu trong từng màn hình.
- Cả hai kiểu có thể chỉnh lời giới thiệu, nhãn nút, mô tả, số cột và màu từng action.
- Màu Telegram dùng ba style semantic: primary (xanh dương), success (xanh lá), danger (đỏ).
- Cấu hình lưu trong PostgreSQL bảng bot_menu_configs, phân biệt primary và secondary.

Reply Keyboard gửi text về chat; bot ánh xạ text nút sang action đã cấu hình. Inline Keyboard gửi callback_data. Không gắn đồng thời hai reply markup cho cùng một message.

## Chạy hai bot trong một mã nguồn

Bot chính luôn bật bằng BOT_TOKEN và ADMIN_ID.

Bot thứ hai tùy chọn bằng BOT_SECOND_TOKEN. BOT_SECOND_ADMIN_ID có thể dùng Admin riêng; nếu bỏ trống sẽ dùng ADMIN_ID. BOT_SECOND_USERNAME là fallback username nếu API getMe không truy cập được.

Trên Render, bot chính nhận webhook /webhook/telegram, bot thứ hai nhận /webhook/telegram/secondary. Mỗi bot có webhook secret riêng. Khi local không có RENDER_EXTERNAL_URL, các bot dùng long polling.

Mỗi instance grammY giữ pending input/cooldown riêng. Mini App được xác thực theo botKey và token tương ứng, không dùng Telegram ID do client tự khai.

## WebSocket realtime

WebSocket nằm tại /ws. Admin phải gửi Telegram WebApp initData đã ký để xác thực theo botKey trước khi nhận sự kiện.

Các event chính: authenticated, runtime.snapshot, runtime.heartbeat, bot.status và bot.menu.updated. Client chỉ nhận sự kiện; mọi thay đổi cấu hình phải gọi REST API đã kiểm tra Admin.

## Tự động tạo thư mục và tệp tính năng

Chạy tại root:

```bash
npm run scaffold:feature -- --name order-history --category api --description "Lịch sử đơn hàng mở rộng"
```

Hoặc dùng GitHub → Actions → Scaffold feature branch. Workflow tạo nhánh, sinh README/index/feature.json và test mẫu (đối với backend), rồi mở Pull Request.

Tên feature phải là kebab-case; loại feature chỉ được api, bot hoặc dashboard. Scaffold từ chối ghi đè file. Feature mới có enabled=false và không tự được nạp runtime. Review phân quyền, migration, API và tests trước khi đăng ký/bật.

## Chạy local

1. Sao chép .env.example thành .env.
2. Điền BOT_TOKEN, ADMIN_ID và DATABASE_URL; thêm bộ biến BOT_SECOND_* nếu dùng bot thứ hai.
3. Chạy:

```bash
npm install
npm run check
npm run build
npm start
```

## Render

Blueprint dùng Node.js 22, build bằng npm install && npm run build, start bằng npm start và health check /healthz.

Nhập BOT_TOKEN, ADMIN_ID, DATABASE_URL, TELEGRAM_WEBHOOK_SECRET. Nếu dùng bot thứ hai, nhập BOT_SECOND_TOKEN, BOT_SECOND_ADMIN_ID và TELEGRAM_SECOND_WEBHOOK_SECRET. BANK_WEBHOOK_SECRET được dùng riêng cho webhook ngân hàng.

## Bảo mật

.env.example chỉ chứa placeholder. Không commit .env, Bot Token, PostgreSQL URL/mật khẩu hoặc webhook secret.

Repository trước đây đã có file mẫu chứa chuỗi giống thông tin xác thực thật. Cần thu hồi Bot Token cũ, đổi credential PostgreSQL và tạo lại webhook secrets. Sửa file mẫu không xóa bí mật khỏi Git history.

CI kiểm tra cú pháp backend, unit tests button theme/scaffold và build dashboard. Trước production cần kiểm thử thực tế cả webhook/polling của hai bot, Reply Keyboard trên Telegram mobile/desktop và giao dịch PostgreSQL.

## Trung tâm quản lý tài khoản và đăng nhập web cũ

Nút MINIGAME LIVE mở Trung tâm quản lý tài khoản với hai lựa chọn: Mini App mới và phiên bản web cũ. Link web cũ chỉ được tạo khi cấu hình LEGACY_ACCOUNT_URL và LEGACY_SESSION_SECRET.

Mỗi link cũ chứa ticket ngẫu nhiên 256-bit, chỉ lưu SHA-256 hash trong PostgreSQL, hết hạn sau 5 phút và chỉ được đổi một lần qua POST /api/legacy/session/exchange. Backend đổi ticket lấy JWT HS256 có hạn 5 phút. Website cũ phải xác minh chữ ký JWT bằng LEGACY_SESSION_SECRET. Không dùng ticket query string như một phiên đăng nhập lâu dài.

Không gửi mật khẩu hoặc OTP qua Telegram Bot.
