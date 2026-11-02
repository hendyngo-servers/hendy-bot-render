const { Markup } = require('telegraf');
const { getUser } = require('./database');

const ADMIN_ID = String(process.env.ADMIN_ID || '');
const WEBAPP_URL = process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL || '';
const GROUP_URL = process.env.GROUP_URL || '';
const CHANNEL_URL = process.env.CHANNEL_URL || '';

function formatMoney(amount) {
  return new Intl.NumberFormat('vi-VN').format(Number(amount || 0)) + ' VNĐ';
}

function usableHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function sectionUrl(section) {
  const base = usableHttpsUrl(WEBAPP_URL);
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set('section', section);
  return url.toString();
}

function appButton(label, section) {
  const url = sectionUrl(section);
  return url
    ? Markup.button.webApp(label, url)
    : Markup.button.callback(label, 'app:missing');
}

function getHomeKeyboard(userId) {
  const rows = [
    [appButton('🎮 MINI GAME LIVE', 'minigame'), appButton('🗂 APP / TOOL', 'tools')],
    [appButton('🛍 MUA CODE', 'codes'), appButton('👛 VÍ ĐIỆN TỬ', 'wallet')],
    [appButton('🛡 OTP & PROXY', 'otp'), appButton('👑 VIP', 'vip')],
    [appButton('💎 TRUNG TÂM KHÁCH HÀNG', 'customer'), appButton('🎧 CSKH', 'support')],
    [appButton('🎁 GIFTCODE', 'giftcode'), appButton('👥 GIỚI THIỆU REF', 'referrals')]
  ];

  const group = usableHttpsUrl(GROUP_URL);
  const channel = usableHttpsUrl(CHANNEL_URL);
  if (group || channel) {
    const links = [];
    if (group) links.push(Markup.button.url('💬 NHÓM CHAT', group));
    if (channel) links.push(Markup.button.url('📢 KÊNH THÔNG BÁO', channel));
    rows.push(links);
  }

  if (String(userId) === ADMIN_ID) {
    // Nút quản trị nằm ở cột bên phải và chỉ xuất hiện với Telegram ID quản trị.
    rows.push([
      appButton('🏠 TRANG CHỦ', 'home'),
      appButton('🛡️ BẢNG ĐIỀU KHIỂN', 'admin')
    ]);
  }

  return Markup.inlineKeyboard(rows);
}

async function sendWelcome(ctx, userId, userData, name) {
  const text =
    '🤖 HENDY BOT\\n' +
    'Xin chào ' + (name || 'bạn') + '!\\n' +
    '🆔 ID: ' + userId + '\\n' +
    '━━━━━━━━━━━━━━━━━━━━\\n' +
    '💰 Số dư: ' + formatMoney(userData.balance) + '\\n' +
    '👑 Cấp độ: VIP ' + Number(userData.vip_level || 0) + '\\n' +
    '━━━━━━━━━━━━━━━━━━━━\\n' +
    'Chọn chức năng bên dưới để mở Mini App:';

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, getHomeKeyboard(userId));
      return;
    } catch (error) {
      // Gửi tin mới nếu tin nhắn cũ không thể chỉnh sửa.
    }
  }
  await ctx.reply(text, getHomeKeyboard(userId));
}

function setupBotClient(bot) {
  bot.start(async (ctx) => {
    const userId = String(ctx.from.id);
    const payload = String(ctx.startPayload || '');
    const refBy = payload.startsWith('ref_') ? payload.slice(4) : '';
    const validRef = /^\d{5,20}$/.test(refBy) && refBy !== userId ? refBy : null;
    const userData = await getUser(
      userId,
      [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
      ctx.from.username,
      validRef
    );
    await sendWelcome(ctx, userId, userData, ctx.from.first_name);
  });

  bot.command('menu', async (ctx) => {
    const userId = String(ctx.from.id);
    const userData = await getUser(userId, ctx.from.first_name, ctx.from.username);
    await sendWelcome(ctx, userId, userData, ctx.from.first_name);
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      'HENDY BOT\\n' +
      '/start - Mở menu dịch vụ\\n' +
      '/menu - Hiển thị lại menu\\n' +
      '/help - Xem hướng dẫn\\n' +
      'Sử dụng Mini App để mua dịch vụ, nạp ví, theo dõi đơn hàng và liên hệ CSKH.'
    );
  });

  bot.command('admin', async (ctx) => {
    const userId = String(ctx.from.id);
    if (userId !== ADMIN_ID) {
      await ctx.reply('Bạn không có quyền quản trị.');
      return;
    }
    const url = sectionUrl('admin');
    if (!url) {
      await ctx.reply('Chưa cấu hình WEBAPP_URL trong Render Environment.');
      return;
    }
    await ctx.reply('Bảng điều khiển dành cho quản trị viên:', Markup.inlineKeyboard([
      [Markup.button.webApp('🛡️ MỞ BẢNG ĐIỀU KHIỂN', url)]
    ]));
  });

  bot.on('callback_query', async (ctx) => {
    const data = String(ctx.callbackQuery.data || '');
    try {
      if (data === 'app:missing') {
        await ctx.answerCbQuery('Ứng dụng chưa cấu hình WEBAPP_URL.', { show_alert: true });
      } else {
        await ctx.answerCbQuery();
      }
    } catch (error) {
      console.error('Không thể trả lời callback Telegram:', error.message);
    }
  });
}

module.exports = { setupBotClient };
