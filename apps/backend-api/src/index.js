const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const express = require('express');
const http = require('http');
const { timingSafeEqual } = require('crypto');
const { Bot, webhookCallback } = require('grammy');
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
const { validateTelegramInitData } = require('./telegramAuth');
const apiRouter = require('./api');

const PORT = Number(process.env.PORT || 8000);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_ID = String(process.env.ADMIN_ID || '');
const BOT_SECOND_TOKEN = process.env.BOT_SECOND_TOKEN || '';
const BOT_SECOND_ADMIN_ID = String(process.env.BOT_SECOND_ADMIN_ID || ADMIN_ID);
const RENDER_EXTERNAL_URL = (process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const SECOND_WEBHOOK_SECRET = process.env.TELEGRAM_SECOND_WEBHOOK_SECRET || '';
const BANK_WEBHOOK_SECRET = process.env.BANK_WEBHOOK_SECRET || '';

function validateBotConfig(config) {
  if (!config.token || !/^\d+:.+$/.test(config.token)) {
    throw new Error('Token Telegram của bot ' + config.key + ' chưa cấu hình hoặc sai định dạng.');
  }
  if (!/^\d{5,20}$/.test(config.adminId)) {
    throw new Error('ADMIN_ID của bot ' + config.key + ' phải là Telegram user ID dạng số.');
  }
  if (RENDER_EXTERNAL_URL && !config.webhookSecret) {
    throw new Error('Thiếu webhook secret cho bot ' + config.key + ' trên Render.');
  }
  if (config.webhookSecret && !/^[A-Za-z0-9_-]{1,256}$/.test(config.webhookSecret)) {
    throw new Error('Webhook secret của bot ' + config.key + ' không hợp lệ.');
  }
}

const botConfigs = [{
  key:'primary', token:BOT_TOKEN, adminId:ADMIN_ID,
  webhookSecret:WEBHOOK_SECRET, webhookPath:'/webhook/telegram'
}];
if (BOT_SECOND_TOKEN) {
  botConfigs.push({
    key:'secondary', token:BOT_SECOND_TOKEN, adminId:BOT_SECOND_ADMIN_ID,
    webhookSecret:SECOND_WEBHOOK_SECRET, webhookPath:'/webhook/telegram/secondary'
  });
}
if (new Set(botConfigs.map(item=>item.token)).size !== botConfigs.length) {
  throw new Error('BOT_TOKEN và BOT_SECOND_TOKEN phải là hai token khác nhau.');
}
botConfigs.forEach(validateBotConfig);

const app = express();
const server = http.createServer(app);
const botInstances = botConfigs.map(config => {
  const bot = new Bot(config.token);
  bot.catch(error => console.error('[grammY:'+config.key+'] Lỗi xử lý update:',error.message));
  setupBotClient(bot,{botKey:config.key,adminId:config.adminId});
  setupBotAdmin(bot,{adminId:config.adminId});
  return {...config,bot,status:RENDER_EXTERNAL_URL?'webhook-starting':'polling-starting'};
});
const bots = Object.fromEntries(botInstances.map(item=>[item.key,item.bot]));
const primaryBot = bots.primary;

const webAppUrl = process.env.WEBAPP_URL || process.env.MINI_APP_URL || RENDER_EXTERNAL_URL;
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
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-telegram-init-data, x-telegram-bot-key, x-bank-webhook-secret, x-telegram-bot-api-secret-token');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '256kb' }));
app.locals.bots = bots;
app.locals.primaryBot = primaryBot;
app.use(apiRouter);

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
      await primaryBot.api.sendMessage(
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

for (const config of botInstances) {
  app.post(
    config.webhookPath,
    (req,res,next) => {
      if (!config.webhookSecret) return next();
      const received=req.get('x-telegram-bot-api-secret-token')||'';
      if (!safeEqual(received,config.webhookSecret)) return res.status(401).send('Unauthorized');
      next();
    },
    webhookCallback(config.bot,'express')
  );
}


const wss = new WebSocketServer({server,path:'/ws',maxPayload:16*1024});
const adminSockets=new Set();
function sendSocket(socket,payload) {
  if(socket.readyState===WebSocket.OPEN) socket.send(JSON.stringify(payload));
}
function broadcastAdmin(type,payload={}) {
  const message={type,payload,timestamp:new Date().toISOString()};
  for(const socket of adminSockets) sendSocket(socket,message);
}
function runtimeSnapshot() {
  return {
    bots:botInstances.map(item=>({
      key:item.key,status:item.status,
      configured:true,
      username:item.bot.botInfo && item.bot.botInfo.username || null
    })),
    timestamp:new Date().toISOString()
  };
}
app.locals.broadcastAdmin=broadcastAdmin;
app.locals.runtimeSnapshot=runtimeSnapshot;

wss.on('connection',(socket,request)=>{
  const origin=request.headers.origin;
  if(origin && !originAllowed(origin)) {
    socket.close(1008,'Origin không được phép');
    return;
  }
  socket.isAdmin=false;
  socket.send(JSON.stringify({type:'connected',message:'Kênh realtime đã kết nối. Đang chờ xác thực Admin.'}));
  socket.on('message',async raw=>{
    let message;
    try { message=JSON.parse(String(raw)); }
    catch { socket.close(1003,'Dữ liệu WebSocket không hợp lệ'); return; }

    if(message.type==='authenticate' && !socket.isAdmin) {
      const botKey=message.botKey==='secondary'?'secondary':'primary';
      const config=botInstances.find(item=>item.key===botKey);
      if(!config) { socket.close(1008,'Bot không hợp lệ'); return; }
      try {
        const user=validateTelegramInitData(String(message.initData||''),config.token);
        if(String(user.id)!==String(config.adminId)) { socket.close(1008,'Không có quyền Admin'); return; }
        socket.isAdmin=true;
        socket.botKey=botKey;
        socket.adminId=String(user.id);
        adminSockets.add(socket);
        sendSocket(socket,{type:'authenticated',botKey,adminId:socket.adminId});
        sendSocket(socket,{type:'runtime.snapshot',payload:runtimeSnapshot()});
      } catch {
        socket.close(1008,'Xác thực Admin thất bại');
      }
      return;
    }
    if(!socket.isAdmin) { socket.close(1008,'Cần xác thực Admin trước'); return; }
    if(message.type==='ping') sendSocket(socket,{type:'pong',timestamp:new Date().toISOString()});
  });
  socket.on('close',()=>adminSockets.delete(socket));
  socket.on('error',()=>adminSockets.delete(socket));
});

const realtimeInterval=setInterval(()=>broadcastAdmin('runtime.heartbeat',runtimeSnapshot()),30000);

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
  await Promise.all(botInstances.map(item=>item.bot.init()));
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(PORT,'0.0.0.0',()=>{server.removeListener('error',reject);resolve();});
  });
  console.log('Express đang lắng nghe tại cổng '+PORT);
  if(RENDER_EXTERNAL_URL) {
    for(const item of botInstances) {
      await item.bot.api.setWebhook(RENDER_EXTERNAL_URL+item.webhookPath,{secret_token:item.webhookSecret});
      item.status='webhook';
      console.log('Webhook grammY đã thiết lập cho bot '+item.key+'.');
    }
  } else {
    for(const item of botInstances) {
      item.status='polling';
      item.bot.start().catch(error=>{
        item.status='error';
        console.error('Không thể khởi chạy grammY polling cho '+item.key+':',error.message);
        broadcastAdmin('bot.status',runtimeSnapshot());
      });
    }
    console.log('Đang chạy '+botInstances.length+' bot bằng long polling.');
  }
  broadcastAdmin('runtime.snapshot',runtimeSnapshot());
}

let isShuttingDown = false;
async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('Đang tắt dịch vụ (' + signal + ')...');

  clearInterval(realtimeInterval);
  if (!RENDER_EXTERNAL_URL) {
    for(const item of botInstances) {
      try { item.bot.stop(); } catch(error) {
        console.error('Lỗi dừng grammY polling ('+item.key+'):',error.message);
      }
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
