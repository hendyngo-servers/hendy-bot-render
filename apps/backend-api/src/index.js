import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Bot, webhookCallback } from 'grammy';
import { makeBotClient } from './botClient.js';
import { makeBotAdmin } from './botAdmin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("❌ Thiếu biến môi trường TELEGRAM_BOT_TOKEN!");
  process.exit(1);
}

// 1. Khởi tạo Bot hệt như logic cũ
const bot = new Bot(BOT_TOKEN);

// Tích hợp file botClient.js và botAdmin.js của bạn vào instance bot
makeBotClient(bot);
makeBotAdmin(bot);

app.use(express.json());

// 2. Định tuyến Webhook nhận tin nhắn từ Telegram
// Đường dẫn webhook sẽ là: https://onrender.com
app.post('/telegram-webhook', webhookCallback(bot, 'express'));

// 3. Phục vụ các file tĩnh (Frontend Admin Dashboard) sau khi đã build
// Trỏ thẳng đến thư mục dist của app admin-dashboard
const frontendPath = path.join(__dirname, '../../../admin-dashboard/dist');
app.use(express.static(frontendPath));

// Định tuyến mọi request còn lại về index.html để hỗ trợ Single Page Application (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Khởi chạy server
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy mượt mà tại cổng ${PORT}`);
});
