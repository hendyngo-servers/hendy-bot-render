const { Markup } = require('telegraf');
const { getUser } = require('./database');

const ADMIN_ID = String(process.env.ADMIN_ID || '');
const WEBAPP_URL = process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL || '';
const GROUP_URL = process.env.GROUP_URL || '';
const CHANNEL_URL = process.env.CHANNEL_URL || '';
const VIETQR_BANK_ID = process.env.VIETQR_BANK_ID || '';
const VIETQR_ACCOUNT_NO = process.env.VIETQR_ACCOUNT_NO || '';
const VIETQR_ACCOUNT_NAME = process.env.VIETQR_ACCOUNT_NAME || '';

const userStates = new Map();

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

function getHomeKeyboard(userId) {
  const buttons = [
    [Markup.button.callback('🚀 MINIGAME LIVE', 'menu:minigame'), Markup.button.callback('🤖 THUÊ TOOL', 'menu:tools')],
    [Markup.button.callback('🛍 MUA CODE', 'menu:lixi')],
    [Markup.button.callback('💳 NẠP TIỀN', 'menu:wallet'), Markup.button.callback('🎁 OTP & PROXY', 'menu:otp')],
    [Markup.button.callback('👑 KHO VIP', 'menu:vip_tools')],
    [Markup.button.callback('💎 TRUNG TÂM KHÁCH HÀNG', 'menu:customer')],
    [Markup.button.callback('🤼 GHÉP ĐÔI', 'menu:matchmaking')],
    [Markup.button.callback('👥 GIỚI THIỆU REF', 'menu:ref')]
  ];

  const group = usableHttpsUrl(GROUP_URL);
  const channel = usableHttpsUrl(CHANNEL_URL);
  if (group || channel) {
    const links = [];
    if (group) links.push(Markup.button.url('💬 NHÓM CHAT', group));
    if (channel) links.push(Markup.button.url('📢 KÊNH THÔNG BÁO', channel));
    buttons.push(links);
  }

  buttons.push([
    Markup.button.callback('🎁 GIFTCODE', 'menu:giftcode'),
    Markup.button.callback('🎧 LIÊN HỆ CSKH', 'menu:support')
  ]);

  const webApp = usableHttpsUrl(WEBAPP_URL);
  if (userId === ADMIN_ID && webApp) {
    buttons.push([Markup.button.webApp('🛡️ BẢNG ĐIỀU KHIỂN', webApp)]);
  }

  return Markup.inlineKeyboard(buttons);
}

function getBackButton() {
  return Markup.inlineKeyboard([[Markup.button.callback('🏠 QUAY LẠI MENU', 'menu:home')]]);
}

function buildQrUrl(amount, userId) {
  if (!VIETQR_BANK_ID || !VIETQR_ACCOUNT_NO || !VIETQR_ACCOUNT_NAME) {
    throw new Error('Chưa cấu hình tài khoản nhận tiền VietQR.');
  }

  const imagePath = [
    encodeURIComponent(VIETQR_BANK_ID),
    encodeURIComponent(VIETQR_ACCOUNT_NO),
    'compact2.png'
  ].join('-');
  const params = new URLSearchParams({
    amount: String(amount),
    addInfo: 'NAP ' + userId,
    accountName: VIETQR_ACCOUNT_NAME
  });
  return 'https://img.vietqr.io/image/' + imagePath + '?' + params.toString();
}

async function sendDepositQr(ctx, amount, userId) {
  const reference = 'NAP ' + userId;
  const qrUrl = buildQrUrl(amount, userId);
  await ctx.replyWithPhoto(
    { url: qrUrl },
    {
      caption: '🏦 THÔNG TIN NẠP TIỀN\n' +
        'Số tiền: ' + formatMoney(amount) + '\n' +
        'Nội dung chuyển khoản: ' + reference,
      ...getBackButton()
    }
  );
}

async function sendWelcome(ctx, userId, userData, name) {
  const message =
    '🤖 HENDY CYBERTECH\n' +
    'Xin chào ' + (name || 'bạn') + '!\n' +
    '🆔 ID: ' + userId + '\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '💰 Số dư: ' + formatMoney(userData.balance) + '\n' +
    '👑 Cấp độ: VIP ' + userData.vip_level + '\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    'Vui lòng chọn chức năng bên dưới:';

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(message, getHomeKeyboard(userId));
      return;
    } catch {
      // Tin nhắn có thể đã bị xóa hoặc không thể chỉnh sửa.
    }
  }
  await ctx.reply(message, getHomeKeyboard(userId));
}

function setupBotClient(bot) {
  bot.start(async (ctx) => {
    const userId = String(ctx.from.id);
    const refBy = ctx.startPayload ? ctx.startPayload.replace(/^ref_/, '') : null;
    const validRef = refBy && /^\d{5,20}$/.test(refBy) && refBy !== userId ? refBy : null;

    const userData = await getUser(
      userId,
      ctx.from.first_name,
      ctx.from.username,
      validRef
    );
    userStates.delete(userId);
    await sendWelcome(ctx, userId, userData, ctx.from.first_name);
  });

  bot.on('callback_query', async (ctx) => {
    try {
      const data = String(ctx.callbackQuery.data || '');
      const userId = String(ctx.from.id);
      const userData = await getUser(userId);

      if (data === 'menu:home') {
        userStates.delete(userId);
        await sendWelcome(ctx, userId, userData, ctx.from.first_name);
      } else if (data === 'menu:wallet') {
        const keyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('50.000 VNĐ', 'deposit:50000'),
            Markup.button.callback('100.000 VNĐ', 'deposit:100000')
          ],
          [Markup.button.callback('✍️ NHẬP SỐ TIỀN KHÁC', 'deposit:custom')],
          [Markup.button.callback('🏠 QUAY LẠI', 'menu:home')]
        ]);
        await ctx.editMessageText(
          '💳 NẠP TIỀN TỰ ĐỘNG\nSố dư hiện tại: ' + formatMoney(userData.balance) +
          '\nChọn mệnh giá muốn nạp:',
          keyboard
        );
      } else if (data.startsWith('deposit:')) {
        const value = data.split(':')[1];
        if (value === 'custom') {
          userStates.set(userId, { action: 'deposit_custom' });
          await ctx.editMessageText(
            'Nhập số tiền muốn nạp (tối thiểu 10.000 VNĐ):',
            getBackButton()
          );
        } else {
          const amount = Number(value);
          if (!Number.isSafeInteger(amount) || amount < 10000) {
            throw new Error('Mệnh giá nạp không hợp lệ.');
          }
          await sendDepositQr(ctx, amount, userId);
        }
      } else if (data === 'menu:giftcode') {
        userStates.set(userId, { action: 'wait_giftcode' });
        await ctx.editMessageText('Vui lòng gửi mã giftcode cần kiểm tra:', getBackButton());
      } else if (data === 'menu:support') {
        userStates.set(userId, { action: 'wait_support_msg' });
        await ctx.editMessageText(
          'Hãy nhập nội dung cần hỗ trợ. Tin nhắn sẽ được chuyển đến quản trị viên.',
          getBackButton()
        );
      } else {
        const names = {
          'menu:minigame': 'Mini Game Live',
          'menu:tools': 'Thuê Tool',
          'menu:lixi': 'Mua Code',
          'menu:otp': 'OTP & Proxy',
          'menu:vip_tools': 'Kho VIP',
          'menu:customer': 'Trung tâm khách hàng',
          'menu:matchmaking': 'Ghép đôi',
          'menu:ref': 'Giới thiệu REF'
        };
        if (names[data]) {
          await ctx.editMessageText(
            'Chức năng ' + names[data] + ' hiện chưa được cấu hình.',
            getBackButton()
          );
        }
      }
    } catch (error) {
      console.error('Xử lý callback Telegram thất bại:', error.message);
      await ctx.reply('Đã xảy ra lỗi khi xử lý yêu cầu. Vui lòng thử lại sau.');
    } finally {
      await ctx.answerCbQuery().catch(() => {});
    }
  });

  bot.on('text', async (ctx, next) => {
    const userId = String(ctx.from.id);
    const state = userStates.get(userId);
    if (!state) return next();

    const text = ctx.message.text.trim();

    if (state.action === 'deposit_custom') {
      const amount = Number(text);
      if (!Number.isSafeInteger(amount) || amount < 10000) {
        await ctx.reply('Số tiền không hợp lệ. Vui lòng nhập số nguyên từ 10.000 VNĐ.');
        return;
      }

      try {
        await sendDepositQr(ctx, amount, userId);
        userStates.delete(userId);
      } catch (error) {
        await ctx.reply(error.message, getBackButton());
        userStates.delete(userId);
      }
    } else if (state.action === 'wait_giftcode') {
      await ctx.reply('Không thể xác thực giftcode vì hệ thống chưa được cấu hình kho mã.');
      userStates.delete(userId);
    } else if (state.action === 'wait_support_msg') {
      if (!/^\d{5,20}$/.test(ADMIN_ID)) {
        await ctx.reply('Hệ thống chưa cấu hình quản trị viên.');
      } else {
        await bot.telegram.sendMessage(
          ADMIN_ID,
          'YÊU CẦU HỖ TRỢ MỚI\n' +
          'Người gửi: ' + userId + '\n' +
          'Nội dung: ' + text.slice(0, 3000)
        );
        await ctx.reply('Đã chuyển yêu cầu hỗ trợ đến quản trị viên.');
      }
      userStates.delete(userId);
    }
  });
}

module.exports = { setupBotClient };
