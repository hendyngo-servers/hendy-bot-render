const express = require('express');
const { Telegraf } = require('telegraf');
const { WebSocketServer } = require('ws');
const path = require('path');
const http = require('http');

const { initDb, getUser, logTransaction, updateBalance } = require('./database');
const { setupBotClient } = require('./botClient');
const { setupBotAdmin } = require('./botAdmin');

const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || "";
const PORT = process.env.PORT || 8000;

// 1. Khởi tạo App & Bot
const app = express();
app.use(express.json());
const bot = new Telegraf(BOT_TOKEN);

// 2. Setup Logic Bot
setupBotClient(bot);
setupBotAdmin(bot);

// 3. Tích hợp Webhook Telegraf vào Express
if (RENDER_URL) {
    const webhookDomain = `${RENDER_URL}/webhook/telegram`;
    bot.telegram.setWebhook(webhookDomain)
        .then(() => console.log(`✅ Đã thiết lập Webhook: ${webhookDomain}`));
    app.use(bot.webhookCallback('/webhook/telegram'));
} else {
    console.log("⚠️ Không có RENDER_EXTERNAL_URL. Nếu chạy local, dùng bot.launch() thay thế.");
}

// 4. API Ngân hàng nạp tiền
app.post('/webhook/bank', async (req, res) => {
    const { amountIn, content, referenceCode } = req.body;
    if (content && content.toUpperCase().includes('NAP')) {
        const parts = content.toUpperCase().split(' ');
        for (let part of parts) {
            if (!isNaN(part)) {
                const userId = part;
                await logTransaction(userId, amountIn, 'DEPOSIT', referenceCode);
                await updateBalance(userId, amountIn, true);
                
                const userData = await getUser(userId);
                const formatted = new Intl.NumberFormat('vi-VN').format(amountIn);
                const bal = new Intl.NumberFormat('vi-VN').format(userData.balance);
                
                await bot.telegram.sendMessage(
                    userId, 
                    `🎉 **NẠP TIỀN THÀNH CÔNG!**\n\n• Nhận: \`+${formatted} VNĐ\`\n• Mã GD: \`${referenceCode}\`\n• Số dư: \`${bal} VNĐ\``,
                    { parse_mode: 'Markdown' }
                );
                break;
            }
        }
    }
    res.json({ status: "success" });
});

// 5. Phục vụ Admin Frontend (từ apps/admin-dashboard/dist)
const frontendDist = path.join(__dirname, '../../admin-dashboard/dist');
app.use(express.static(frontendDist));
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
});

// 6. Khởi tạo HTTP Server & WebSocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
    console.log('🔗 WebSocket Client Connected');
    ws.on('message', (message) => {
        // Broadcast data - Ví dụ dùng cho "Hệ Thống Ghép Đối Đầu" hoặc "Đồng bộ mã nguồn"
        wss.clients.forEach((client) => {
            if (client.readyState === 1) { // 1 = OPEN
                client.send(`🔄 Đồng bộ từ Server: ${message}`);
            }
        });
    });
    ws.on('close', () => console.log('❌ WebSocket Client Disconnected'));
});

// Khởi chạy hệ thống
(async () => {
    await initDb();
    server.listen(PORT, () => {
        console.log(`🚀 Monorepo (Node.js) đang chạy tại Port ${PORT}`);
    });
})();
