const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const express = require('express');
const http = require('http');
const { timingSafeEqual } = require('crypto');
const { Telegraf } = require('telegraf');
const { WebSocketServer, WebSocket } = require('ws');

const {
  initDb,
  getUser,
  processDeposit,
  checkDb,
  closeDb
} = require('./database');
const { setupBotClient } = require('./botClient');
const { setupBotAdmin } = require('./botAdmin');

const PORT = Number(process.env.PORT || 8000);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_ID = String(process.env.ADMIN_ID || '');
const RENDER_EXTERNAL_URL = (process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const BANK_WEBHOOK_SECRET = process.env.BANK_WEBHOOK_SECRET || '';

if (!BOT_TOKEN || !/^\d+:.+$/.test(BOT_TOKEN)) {
  throw new Error('BOT_TOKEN chưa được cấu hình hoặc không đúng định dạng.');
}
if (!/^\d{5,20}$/.test(ADMIN_ID)) {
  throw new Error('ADMIN_ID phải là Telegram user ID dạng số.');
}
if (WEBHOOK_SECRET && !/^[A-Za-z0-9_-]{1,256}$/.test(WEBHOOK_SECRET)) {
  throw new Error('TELEGRAM_WEBHOOK_SECRET chỉ được chứa chữ, số, _ hoặc - và tối đa 256 ký tự.');
}

const app = express();
const server = http.createServer(app);
const bot = new Telegraf(BOT_TOKEN);

const webAppUrl = process.env.WEBAPP_URL || RENDER_EXTERNAL_URL;
const dashboardDist = path.resolve(__dirname, '../../admin-dashboard/dist');
const dashboardIndex = path.join(dashboardDist, 'index.html');

const allowedOrigins = new Set(
  [
    ...(process.env.ALLOWED_ORIGINS || '').split(','),
    RENDER_EXTERNAL_URL,
    webAppUrl
  ]
    .map((value) => String(value || '').trim().replace(/\/$/, ''))
    .filter(Boolean)
);

function safeEqual(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function originAllowed(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin.replace(/\/$/, ''))) return true;
  return process.env.NODE_ENV !== 'production' &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  const origin = req.get('origin');
  if (origin && !originAllowed(origin)) {
    return res.status(403).json({ error: 'Origin không được phép.' });
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-bank-webhook-secret');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '256kb' }));

bot.catch((error) => {
  console.error('Lỗi xử lý Telegram update:', error.message);
});

setupBotClient(bot);
setupBotAdmin(bot);

app.get('/healthz', async (req, res) => {
  try {
    await checkDb();
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', dependency: 'database' });
  }
});

app.get('/api/health', async (req, res) => {
  let database = 'ok';
  try {
    await checkDb();
  } catch {
    database = 'error';
  }

  res.status(database === 'ok' ? 200 : 503).json({
    service: 'hendy-bot-render',
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    telegram: 'configured',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.post('/webhook/bank', async (req, res) => {
  if (!BANK_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Webhook ngân hàng chưa được cấu hình.' });
  }

  if (!safeEqual(req.get('x-bank-webhook-secret') || '', BANK_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Webhook secret không hợp lệ.' });
  }

  const amount = Number(req.body && req.body.amountIn);
  const referenceCode = String((req.body && req.body.referenceCode) || '').trim();
  const content = String((req.body && req.body.content) || '').trim();
  const match = content.match(/^NAP\s+(\d{5,20})$/i);

  if (!match || !Number.isSafeInteger(amount) || amount <= 0 ||
      !referenceCode || referenceCode.length > 128) {
    return res.status(400).json({ error: 'Dữ liệu giao dịch không hợp lệ.' });
  }

  try {
    const userId = match[1];
    const result = await processDeposit({ userId, amount, referenceCode });

    if (result.duplicate) {
      return res.status(200).json({ status: 'duplicate', referenceCode });
    }

    try {
      const user = await getUser(userId);
      const formattedAmount = new Intl.NumberFormat('vi-VN').format(amount);
      const formattedBalance = new Intl.NumberFormat('vi-VN').format(Number(user.balance));
      await bot.telegram.sendMessage(
        userId,
        '🎉 NẠP TIỀN THÀNH CÔNG!\n' +
        'Số tiền nhận: +' + formattedAmount + ' VNĐ\n' +
        'Mã giao dịch: ' + referenceCode + '\n' +
        'Số dư hiện tại: ' + formattedBalance + ' VNĐ'
      );
    } catch (notifyError) {
      console.error('Đã ghi nhận nạp tiền nhưng không gửi được tin nhắn Telegram:', notifyError.message);
    }

    return res.status(200).json({ status: 'success', referenceCode });
  } catch (error) {
    console.error('Xử lý webhook ngân hàng thất bại:', error.message);
    return res.status(500).json({ error: 'Không thể xử lý giao dịch.' });
  }
});

if (WEBHOOK_SECRET) {
  app.use('/webhook/telegram', (req, res, next) => {
    const received = req.get('x-telegram-bot-api-secret-token') || '';
    if (!safeEqual(received, WEBHOOK_SECRET)) {
      return res.status(401).send('Unauthorized');
    }
    next();
  });
}
app.use('/webhook/telegram', bot.webhookCallback('/webhook/telegram'));

const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 16 * 1024
});

wss.on('connection', (socket, request) => {
  const origin = request.headers.origin;
  if (origin && !originAllowed(origin)) {
    socket.close(1008, 'Origin không được phép');
    return;
  }

  socket.send(JSON.stringify({
    type: 'connected',
    message: 'Đã kết nối bảng điều khiển.',
    timestamp: new Date().toISOString()
  }));

  // WebSocket dashboard chỉ nhận sự kiện trạng thái; không broadcast dữ liệu tùy ý từ client.
  socket.on('message', () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'info',
        message: 'Kênh này chỉ dùng để nhận trạng thái từ máy chủ.'
      }));
    }
  });
});

app.use(express.static(dashboardDist, {
  index: false,
  fallthrough: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

app.get('/', (req, res, next) => {
  res.sendFile(dashboardIndex, (error) => {
    if (error) next(error);
  });
});

app.use((req, res, next) => {
  if (req.method === 'GET' && req.accepts('html') && !req.path.startsWith('/api/')) {
    return res.sendFile(dashboardIndex, (error) => {
      if (error) next(error);
    });
  }
  next();
});

app.use((error, req, res, next) => {
  console.error('Express request error:', error.message);
  if (res.headersSent) return next(error);
  res.status(error.status || 500).json({
    error: error.status && error.status < 500 ? error.message : 'Lỗi máy chủ nội bộ.'
  });
});

async function start() {
  await initDb();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '0.0.0.0', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  console.log('Express đang lắng nghe tại cổng ' + PORT);

  if (RENDER_EXTERNAL_URL) {
    const webhookUrl = RENDER_EXTERNAL_URL + '/webhook/telegram';
    const options = WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : {};
    await bot.telegram.setWebhook(webhookUrl, options);
    console.log('Telegram webhook đã được thiết lập.');
  } else {
    bot.launch().catch((error) => {
      console.error('Không thể khởi chạy Telegram polling:', error.message);
      process.exitCode = 1;
    });
    console.log('Telegram bot chạy bằng long polling.');
  }
}

let isShuttingDown = false;
async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('Đang tắt dịch vụ (' + signal + ')...');

  if (!RENDER_EXTERNAL_URL) {
    try { bot.stop(signal); } catch (error) {
      console.error('Lỗi dừng Telegram polling:', error.message);
    }
  }

  for (const socket of wss.clients) {
    socket.close(1001, 'Máy chủ đang khởi động lại');
  }
  wss.close();

  server.close(async () => {
    try {
      await closeDb();
      process.exit(0);
    } catch (error) {
      console.error('Lỗi khi đóng PostgreSQL:', error.message);
      process.exit(1);
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

start().catch(async (error) => {
  console.error('Không thể khởi động dịch vụ:', error.message);
  try { await closeDb(); } catch {}
  process.exit(1);
});
