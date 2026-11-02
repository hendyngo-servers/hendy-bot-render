const crypto = require('crypto');
const { getUser, pool } = require('./database');
const { callbackButton, urlButton, webAppButton, inlineKeyboard } = require('./ui/buttonTheme');

const ADMIN_ID = String(process.env.ADMIN_ID || '');
const MINI_APP_URL = process.env.MINI_APP_URL || process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL || '';
const INPUT_TTL_MS = 10 * 60 * 1000;
const ALLOWED_BRANDS = ['QQ88', '78WIN', 'SC88', 'C168', 'CM88', 'F8BET'];
const pendingInputs = new Map();
const cooldowns = new Map();

const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const money = value => Number(value || 0).toLocaleString('vi-VN') + ' VNĐ';
const dateText = value => value ? new Date(value).toLocaleString('vi-VN') : '—';

function getMiniAppUrl(section = 'admin') {
  if (!/^https:\/\//i.test(String(MINI_APP_URL || ''))) return null;
  try {
    const url = new URL(MINI_APP_URL);
    url.searchParams.set('section', section);
    return url.toString();
  } catch {
    return null;
  }
}

function mainMenu(userId) {
  const rows = [
    [
      callbackButton('🚀 MINIGAME LIVE', 'member:live', 'primary'),
      callbackButton('🧰 THUÊ TOOL (NEW)', 'member:tools', 'primary')
    ],
    [callbackButton('🎁 MUA LÌ XÌ · CODE MÀN · CODE TELE', 'member:codes', 'success')],
    [
      callbackButton('💳 NẠP TIỀN', 'member:wallet', 'success'),
      callbackButton('⚙️ OTP & PROXY', 'member:otp', 'primary')
    ],
    [callbackButton('🏆 VIP KHO CÔNG CỤ ĐẶC QUYỀN', 'member:viptools', 'primary')],
    [callbackButton('💎 TRUNG TÂM KHÁCH HÀNG', 'member:customer', 'primary')],
    [callbackButton('⚔️ HỆ THỐNG GHÉP ĐỐI ĐẦU', 'member:duel', 'primary')],
    [
      callbackButton('🎊 GIỚI THIỆU REF', 'member:ref', 'success'),
      callbackButton('👑 TRUNG TÂM VIP', 'member:vip', 'primary')
    ],
    [
      callbackButton('🗣️ NHÓM CHAT', 'member:group', 'primary'),
      callbackButton('📢 KÊNH THÔNG BÁO', 'member:news', 'primary')
    ],
    [
      callbackButton('🎟️ NHẬP GIFTCODE', 'member:gift', 'success'),
      callbackButton('🧑‍💻 LIÊN HỆ CSKH', 'member:support', 'primary')
    ]
  ];

  if (ADMIN_ID && String(userId) === ADMIN_ID) {
    const adminUrl = getMiniAppUrl('admin');
    rows.push([adminUrl
      ? webAppButton('🛡️ BẢNG ĐIỀU KHIỂN ADMIN', adminUrl, 'primary')
      : callbackButton('🛡️ ADMIN · CẤU HÌNH MINI_APP_URL', 'member:admin-unavailable', 'danger')]);
  }
  return inlineKeyboard(rows);
}

function homeKeyboard(userId) {
  const rows = [[callbackButton('🏠 MENU CHÍNH', 'member:home', 'primary')]];
  if (ADMIN_ID && String(userId) === ADMIN_ID) {
    const adminUrl = getMiniAppUrl('admin');
    if (adminUrl) rows.push([webAppButton('🛡️ BẢNG ĐIỀU KHIỂN ADMIN', adminUrl, 'primary')]);
  }
  return inlineKeyboard(rows);
}

function setPending(userId, data) {
  pendingInputs.set(String(userId), { ...data, expiresAt: Date.now() + INPUT_TTL_MS });
}

function editOrReply(ctx, text, keyboard) {
  const markup = keyboard || homeKeyboard(ctx.from.id);
  const options = { parse_mode: 'HTML', disable_web_page_preview: true, ...markup };
  if (ctx.callbackQuery && ctx.editMessageText) {
    return ctx.editMessageText(text, options).catch(error => {
      if (/message is not modified/i.test(error.message || '')) return null;
      return ctx.reply(text, options);
    });
  }
  return ctx.reply(text, options);
}

async function getSettings(keys) {
  const result = await pool.query(
    'SELECT key,value FROM app_settings WHERE key = ANY($1::text[])',
    [keys]
  );
  return result.rows.reduce((out, row) => {
    out[row.key] = row.value;
    return out;
  }, {});
}

async function listLinkedAccounts(userId) {
  const result = await pool.query(
    'SELECT id,brand,username,created_at FROM linked_accounts WHERE user_id=$1 ORDER BY created_at DESC',
    [String(userId)]
  );
  return result.rows;
}

async function welcomeText(ctx, userId, user) {
  const accounts = await listLinkedAccounts(userId);
  const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || 'thành viên';
  return [
    '🤖 <b>HENDY BOT | HENDY CYBERTECH</b>',
    'Xin chào <b>' + escapeHtml(name) + '</b>!',
    '🆔 ID Telegram: <code>' + escapeHtml(userId) + '</code>',
    '━━━━━━━━━━━━━━━━━━━━',
    '💰 Ví chính: <b>' + money(user.balance) + '</b>',
    '👑 Cấp thành viên: <b>VIP ' + Number(user.vip_level || 0) + '</b>',
    '🔗 Tài khoản đã liên kết: <b>' + accounts.length + '</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    'Chọn chức năng bên dưới. Các thao tác thành viên được xử lý trực tiếp trong Telegram Bot.'
  ].join('\n');
}

async function listCatalog(category) {
  const actual = category === 'viptools' ? 'vip' : category;
  const allowed = ['minigame', 'tools', 'codes', 'otp', 'proxy', 'vip'];
  if (!allowed.includes(actual)) return [];
  const result = await pool.query(
    'SELECT id,name,price,description,stock,duration_days FROM products ' +
    'WHERE category=$1 AND is_active=TRUE AND (stock IS NULL OR stock>0) ORDER BY created_at DESC LIMIT 20',
    [actual]
  );
  return result.rows;
}

async function listOrders(userId, limit = 5) {
  const result = await pool.query(
    'SELECT order_code,product_name,amount,status,created_at FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2',
    [String(userId), limit]
  );
  return result.rows;
}

async function showCatalog(ctx, userId, category, title) {
  const [products, orders] = await Promise.all([listCatalog(category), listOrders(userId, 5)]);
  const lines = [
    '🛍️ <b>' + escapeHtml(title) + '</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    products.length ? 'Chọn sản phẩm bên dưới để tạo đơn hàng:' : 'Hiện chưa có sản phẩm nào được Admin đăng bán.',
    '',
    '<b>ĐƠN GẦN ĐÂY</b>',
    ...(orders.length ? orders.map(order => {
      const status = ({pending:'Chờ duyệt',processing:'Đang xử lý',completed:'Hoàn tất',cancelled:'Đã hủy',rejected:'Từ chối'})[order.status] || order.status;
      return '• ' + escapeHtml(order.product_name) + ' — ' + money(order.amount) + ' · ' + status;
    }) : ['Chưa có đơn hàng.'])
  ];
  const rows = products.map(item => [
    callbackButton(String(item.name + ' · ' + money(item.price)).slice(0, 60), 'member:order:' + item.id, 'success')
  ]);
  rows.push([callbackButton('🏠 MENU CHÍNH', 'member:home', 'primary')]);
  return editOrReply(ctx, lines.join('\n'), inlineKeyboard(rows));
}

async function createMemberOrder(userId, productId) {
  if (!/^\d{1,18}$/.test(String(productId))) throw new Error('ID sản phẩm không hợp lệ.');
  const client = await pool.connect();
  let order;
  try {
    await client.query('BEGIN');
    const item = await client.query('SELECT * FROM products WHERE id=$1 AND is_active=TRUE FOR UPDATE', [String(productId)]);
    if (!item.rowCount) throw new Error('Sản phẩm không còn được bán.');
    const product = item.rows[0];
    if (product.stock !== null && Number(product.stock) <= 0) throw new Error('Sản phẩm đã hết hàng.');
    const member = await client.query('SELECT balance FROM users WHERE user_id=$1 FOR UPDATE', [String(userId)]);
    if (!member.rowCount) throw new Error('Không tìm thấy hồ sơ thành viên.');
    if (Number(member.rows[0].balance) < Number(product.price)) throw new Error('Số dư không đủ. Hãy chọn NẠP TIỀN trước khi mua.');

    const orderCode = 'HD' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
    const balance = await client.query('UPDATE users SET balance=balance-$1 WHERE user_id=$2 RETURNING balance', [product.price, String(userId)]);
    const created = await client.query(
      "INSERT INTO orders (order_code,user_id,product_id,product_name,category,amount,status) " +
      "VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING order_code,product_name,amount,status",
      [orderCode, String(userId), product.id, product.name, product.category, product.price]
    );
    await client.query(
      "INSERT INTO wallet_ledger (reference_code,user_id,amount,transaction_type,description) VALUES ($1,$2,$3,'PURCHASE',$4)",
      ['order:' + orderCode, String(userId), -Number(product.price), 'Thanh toán đơn ' + orderCode]
    );
    await client.query(
      "INSERT INTO transactions (user_id,amount,type,reference_code,status) VALUES ($1,$2,'PURCHASE',$3,'paid')",
      [String(userId), product.price, orderCode]
    );
    if (product.stock !== null) await client.query('UPDATE products SET stock=stock-1,updated_at=NOW() WHERE id=$1', [product.id]);
    await client.query('COMMIT');
    order = { ...created.rows[0], balance: Number(balance.rows[0].balance) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return order;
}

async function showDeposit(ctx, userId, amount) {
  if (!Number.isSafeInteger(amount) || amount < 10000 || amount > 500000000) {
    return ctx.reply('⚠️ Số tiền nạp phải từ 10.000 đến 500.000.000 VNĐ.');
  }
  const settings = await getSettings(['VIETQR_BANK_ID','VIETQR_ACCOUNT_NO','VIETQR_ACCOUNT_NAME']);
  const bankId = settings.VIETQR_BANK_ID || process.env.VIETQR_BANK_ID || '';
  const accountNo = settings.VIETQR_ACCOUNT_NO || process.env.VIETQR_ACCOUNT_NO || '';
  const accountName = settings.VIETQR_ACCOUNT_NAME || process.env.VIETQR_ACCOUNT_NAME || '';
  if (!bankId || !accountNo || !accountName) return editOrReply(ctx, '⚠️ Admin chưa cấu hình tài khoản VietQR. Vui lòng liên hệ CSKH.', homeKeyboard(userId));
  const imagePath = [encodeURIComponent(bankId), encodeURIComponent(accountNo), 'compact2.png'].join('-');
  const params = new URLSearchParams({ amount:String(amount), addInfo:'NAP ' + userId, accountName });
  const qrUrl = 'https://img.vietqr.io/image/' + imagePath + '?' + params.toString();
  const caption = [
    '💳 <b>THÔNG TIN NẠP TIỀN</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    'Số tiền: <b>' + money(amount) + '</b>',
    'Ngân hàng: <b>' + escapeHtml(bankId) + '</b>',
    'Số tài khoản: <code>' + escapeHtml(accountNo) + '</code>',
    'Chủ tài khoản: <b>' + escapeHtml(accountName) + '</b>',
    'Nội dung chuyển khoản: <code>NAP ' + escapeHtml(userId) + '</code>',
    '━━━━━━━━━━━━━━━━━━━━',
    'Trạng thái: <b>Chờ đối soát</b>',
    'Chuyển đúng số tiền và nội dung. Ví được cộng sau khi webhook ngân hàng hợp lệ được xác nhận.'
  ].join('\n');
  const keyboard = inlineKeyboard([
    [callbackButton('🔄 KIỂM TRA LỊCH SỬ NẠP', 'member:deposit-history', 'primary')],
    [callbackButton('🏠 MENU CHÍNH', 'member:home', 'primary')]
  ]);
  try {
    return await ctx.replyWithPhoto(qrUrl, { caption, parse_mode:'HTML', ...keyboard });
  } catch {
    return editOrReply(ctx, caption + '\n\nKhông tải được ảnh QR. Bạn vẫn có thể dùng thông tin chuyển khoản phía trên.', keyboard);
  }
}

async function showDepositHistory(ctx, userId) {
  const result = await pool.query(
    "SELECT amount,reference_code,status,created_at FROM transactions WHERE user_id=$1 AND type='DEPOSIT' ORDER BY created_at DESC LIMIT 10",
    [String(userId)]
  );
  const lines = ['💳 <b>LỊCH SỬ NẠP TIỀN</b>', '━━━━━━━━━━━━━━━━━━━━'];
  if (!result.rowCount) lines.push('Chưa ghi nhận giao dịch nạp tiền.');
  for (const row of result.rows) {
    lines.push('• +' + money(row.amount) + ' · ' + escapeHtml(row.reference_code || '—'));
    lines.push('  ' + dateText(row.created_at) + ' · ' + escapeHtml(row.status));
  }
  return editOrReply(ctx, lines.join('\n'), homeKeyboard(userId));
}

async function showCustomer(ctx, userId) {
  const user = await getUser(userId);
  const [accounts, orders, tickets] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM linked_accounts WHERE user_id=$1', [String(userId)]),
    pool.query('SELECT COUNT(*)::int AS total FROM orders WHERE user_id=$1', [String(userId)]),
    pool.query('SELECT COUNT(*)::int AS total FROM support_tickets WHERE user_id=$1', [String(userId)])
  ]);
  return editOrReply(ctx, [
    '💎 <b>TRUNG TÂM KHÁCH HÀNG</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    '🆔 Telegram ID: <code>' + escapeHtml(userId) + '</code>',
    '💰 Số dư: <b>' + money(user && user.balance) + '</b>',
    '👑 Cấp thành viên: <b>VIP ' + Number(user && user.vip_level || 0) + '</b>',
    '🔗 Tài khoản liên kết: <b>' + accounts.rows[0].total + '</b>',
    '🧾 Tổng đơn hàng: <b>' + orders.rows[0].total + '</b>',
    '🎧 Yêu cầu CSKH: <b>' + tickets.rows[0].total + '</b>'
  ].join('\n'), inlineKeyboard([
    [callbackButton('🧾 LỊCH SỬ ĐƠN HÀNG', 'member:orders', 'primary')],
    [callbackButton('🔗 TÀI KHOẢN ĐÃ LIÊN KẾT', 'member:live', 'primary')],
    [callbackButton('🏠 MENU CHÍNH', 'member:home', 'primary')]
  ]));
}

async function showOrders(ctx, userId) {
  const orders = await listOrders(userId, 10);
  const lines = ['🧾 <b>LỊCH SỬ ĐƠN HÀNG</b>', '━━━━━━━━━━━━━━━━━━━━'];
  if (!orders.length) lines.push('Bạn chưa có đơn hàng.');
  for (const order of orders) {
    const status = ({pending:'Chờ duyệt',processing:'Đang xử lý',completed:'Hoàn tất',cancelled:'Đã hủy',rejected:'Từ chối'})[order.status] || order.status;
    lines.push('• <b>' + escapeHtml(order.product_name) + '</b> — ' + money(order.amount));
    lines.push('  <code>' + escapeHtml(order.order_code) + '</code> · ' + status + ' · ' + dateText(order.created_at));
  }
  return editOrReply(ctx, lines.join('\n'), homeKeyboard(userId));
}

async function claimGiftcode(userId, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,64}$/.test(code)) throw new Error('Mã giftcode không đúng định dạng.');
  const client = await pool.connect();
  let reward = 0;
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM giftcodes WHERE code=$1 FOR UPDATE', [code]);
    if (!found.rowCount) throw new Error('Giftcode không tồn tại.');
    const gift = found.rows[0];
    if (!gift.is_active || (gift.expires_at && new Date(gift.expires_at) < new Date())) throw new Error('Giftcode đã hết hạn hoặc bị khóa.');
    if (Number(gift.redeemed_count) >= Number(gift.max_redemptions)) throw new Error('Giftcode đã hết lượt.');
    const inserted = await client.query(
      'INSERT INTO giftcode_redemptions (code,user_id,reward_amount) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING code',
      [code, String(userId), gift.reward_amount]
    );
    if (!inserted.rowCount) throw new Error('Bạn đã sử dụng giftcode này rồi.');
    reward = Number(gift.reward_amount);
    if (reward > 0) {
      await client.query('UPDATE users SET balance=balance+$1 WHERE user_id=$2', [reward, String(userId)]);
      await client.query(
        "INSERT INTO wallet_ledger (reference_code,user_id,amount,transaction_type,description) VALUES ($1,$2,$3,'GIFTCODE',$4)",
        ['giftcode:' + code + ':' + userId, String(userId), reward, 'Nhận thưởng giftcode ' + code]
      );
      await client.query(
        "INSERT INTO transactions (user_id,amount,type,reference_code,status) VALUES ($1,$2,'GIFTCODE',$3,'paid')",
        [String(userId), reward, code]
      );
    }
    await client.query('UPDATE giftcodes SET redeemed_count=redeemed_count+1 WHERE code=$1', [code]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return reward;
}

async function showReferral(ctx, userId) {
  const [count, rewards, settings] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM users WHERE ref_by=$1', [String(userId)]),
    pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM wallet_ledger WHERE user_id=$1 AND transaction_type='REFERRAL_REWARD'", [String(userId)]),
    getSettings(['referral_commission_percent'])
  ]);
  let botUsername = String(process.env.BOT_USERNAME || '').replace(/^@/, '');
  if (!botUsername) {
    try { botUsername = (await ctx.telegram.getMe()).username || ''; } catch {}
  }
  const link = botUsername ? 'https://t.me/' + botUsername + '?start=ref_' + userId : '';
  const rows = [];
  if (link) rows.push([urlButton('📤 MỞ LINK GIỚI THIỆU', link, 'success')]);
  rows.push([callbackButton('🏠 MENU CHÍNH', 'member:home', 'primary')]);
  return editOrReply(ctx, [
    '🎊 <b>GIỚI THIỆU REF</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    '👥 Thành viên đã mời: <b>' + count.rows[0].total + '</b>',
    '💰 Hoa hồng đã nhận: <b>' + money(rewards.rows[0].total) + '</b>',
    '📊 Tỷ lệ hiện tại: <b>' + Number(settings.referral_commission_percent || 0) + '%</b>',
    '',
    link ? '🔗 Link giới thiệu:\n<code>' + escapeHtml(link) + '</code>' : 'Chưa xác định được username của bot.'
  ].join('\n'), inlineKeyboard(rows));
}

async function showVip(ctx, userId) {
  const user = await getUser(userId);
  const products = await listCatalog('vip');
  const level = Number(user.vip_level || 0);
  const thresholds = [0, 500000, 2000000, 5000000];
  const lines = [
    '👑 <b>TRUNG TÂM VIP</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    'Cấp hiện tại: <b>VIP ' + level + '</b>',
    'Tổng nạp: <b>' + money(user.total_deposited) + '</b>',
    'Mốc tiếp theo: <b>' + (level >= 3 ? 'Cấp tối đa' : money(thresholds[level + 1])) + '</b>',
    '',
    'Gói VIP đang mở bán: ' + products.length
  ];
  const rows = products.map(item => [callbackButton(item.name + ' · ' + money(item.price), 'member:order:' + item.id, 'success')]);
  rows.push([callbackButton('🏠 MENU CHÍNH', 'member:home', 'primary')]);
  return editOrReply(ctx, lines.join('\n'), inlineKeyboard(rows));
}

async function showCommunityLink(ctx, userId, kind) {
  const key = kind === 'group' ? 'GROUP_URL' : 'CHANNEL_URL';
  const settings = await getSettings([key]);
  const raw = settings[key] || process.env[key] || '';
  let url = null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:') url = parsed.toString();
  } catch {}
  if (!url) return editOrReply(ctx, '⚠️ Admin chưa cấu hình liên kết ' + (kind === 'group' ? 'nhóm chat' : 'kênh thông báo') + '.', homeKeyboard(userId));
  return editOrReply(ctx, '🔗 <b>' + (kind === 'group' ? 'NHÓM CHAT' : 'KÊNH THÔNG BÁO') + '</b>\nBấm nút bên dưới để mở liên kết.', inlineKeyboard([
    [urlButton(kind === 'group' ? '🗣️ MỞ NHÓM CHAT' : '📢 MỞ KÊNH THÔNG BÁO', url, 'primary')],
    [callbackButton('🏠 MENU CHÍNH', 'member:home', 'primary')]
  ]));
}

async function showLive(ctx, userId) {
  const accounts = await pool.query(
    'SELECT id,brand,username FROM linked_accounts WHERE user_id=$1 ORDER BY created_at DESC',
    [String(userId)]
  );
  const rows = accounts.rows.map(item => [callbackButton('🗑 ' + item.brand + ' · ' + item.username, 'member:link-delete:' + item.id, 'danger')]);
  rows.push([callbackButton('➕ LIÊN KẾT TÀI KHOẢN', 'member:link-new', 'success')]);
  rows.push([callbackButton('🏠 MENU CHÍNH', 'member:home', 'primary')]);
  return editOrReply(ctx, [
    '🚀 <b>MINIGAME LIVE · QUẢN LÝ TÀI KHOẢN</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    'Tài khoản đã liên kết: <b>' + accounts.rowCount + '</b>',
    'Danh sách hỗ trợ: ' + ALLOWED_BRANDS.join(', '),
    'Chỉ lưu tên đăng nhập và thương hiệu. Không gửi mật khẩu/OTP vào bot.'
  ].join('\n'), inlineKeyboard(rows));
}

async function showDuel(ctx, userId) {
  const active = await pool.query(
    "SELECT * FROM matchmaking_matches WHERE status='matched' AND (player_one=$1 OR player_two=$1) ORDER BY created_at DESC LIMIT 1",
    [String(userId)]
  );
  if (active.rowCount) {
    const match = active.rows[0];
    const opponentId = match.player_one === String(userId) ? match.player_two : match.player_one;
    const opponent = await pool.query('SELECT name,username FROM users WHERE user_id=$1', [opponentId]);
    const name = opponent.rows[0] && (opponent.rows[0].name || opponent.rows[0].username) || 'Thành viên Hendy';
    return editOrReply(ctx, '⚔️ Đã ghép đối đầu với <b>' + escapeHtml(name) + '</b>. Mã ghép: <code>#' + match.id + '</code>.', inlineKeyboard([
      [callbackButton('✅ KẾT THÚC LƯỢT ĐỐI ĐẦU', 'member:duel-finish:' + match.id, 'success')],
      [callbackButton('🏠 MENU CHÍNH', 'member:home', 'primary')]
    ]));
  }
  const client = await pool.connect();
  let match = null;
  let waiting = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['hendy-matchmaking:quick']);
    const queued = await client.query("SELECT id FROM matchmaking_queue WHERE user_id=$1 AND status='waiting' LIMIT 1 FOR UPDATE", [String(userId)]);
    if (queued.rowCount) waiting = true;
    else {
      const partner = await client.query(
        "SELECT id,user_id FROM matchmaking_queue WHERE status='waiting' AND mode='quick' AND user_id<>$1 ORDER BY created_at ASC LIMIT 1 FOR UPDATE",
        [String(userId)]
      );
      if (partner.rowCount) {
        const created = await client.query(
          "INSERT INTO matchmaking_matches (player_one,player_two,mode,status) VALUES ($1,$2,'quick','matched') RETURNING *",
          [partner.rows[0].user_id, String(userId)]
        );
        match = created.rows[0];
        await client.query("UPDATE matchmaking_queue SET status='paired',matched_user_id=$1,match_id=$2,updated_at=NOW() WHERE id=$3", [String(userId), match.id, partner.rows[0].id]);
        await client.query("INSERT INTO matchmaking_queue (user_id,mode,status,matched_user_id,match_id) VALUES ($1,'quick','paired',$2,$3)", [String(userId), partner.rows[0].user_id, match.id]);
      } else {
        await client.query("INSERT INTO matchmaking_queue (user_id,mode,status) VALUES ($1,'quick','waiting')", [String(userId)]);
        waiting = true;
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  if (!match) {
    return editOrReply(ctx, '⚔️ <b>HỆ THỐNG GHÉP ĐỐI ĐẦU</b>\n\n' + (waiting ? 'Bạn đã vào hàng chờ. Bot sẽ thông báo khi tìm được đối thủ.' : 'Không thể tham gia hàng chờ.'), inlineKeyboard([
      [callbackButton('🔄 KIỂM TRA TRẠNG THÁI', 'member:duel', 'primary')],
      [callbackButton('❌ RỜI HÀNG CHỜ', 'member:duel-leave', 'danger')],
      [callbackButton('🏠 MENU CHÍNH', 'member:home', 'primary')]
    ]));
  }
  const opponentId = match.player_one === String(userId) ? match.player_two : match.player_one;
  for (const recipient of [String(userId), opponentId]) {
    try { await ctx.telegram.sendMessage(recipient, '⚔️ Bạn đã được ghép đối đầu. Mã ghép #' + match.id); } catch {}
  }
  return editOrReply(ctx, '✅ Đã ghép đối đầu thành công. Mã ghép: <code>#' + match.id + '</code>.', inlineKeyboard([
    [callbackButton('✅ KẾT THÚC LƯỢT ĐỐI ĐẦU', 'member:duel-finish:' + match.id, 'success')],
    [callbackButton('🏠 MENU CHÍNH', 'member:home', 'primary')]
  ]));
}

async function finishDuel(ctx, userId, matchId) {
  const result = await pool.query(
    "UPDATE matchmaking_matches SET status='completed',finished_at=NOW() WHERE id=$1 AND status='matched' AND (player_one=$2 OR player_two=$2) RETURNING player_one,player_two",
    [String(matchId), String(userId)]
  );
  if (!result.rowCount) throw new Error('Không tìm thấy lượt ghép đang hoạt động.');
  await pool.query("UPDATE matchmaking_queue SET status='completed',updated_at=NOW() WHERE match_id=$1", [String(matchId)]);
  const other = result.rows[0].player_one === String(userId) ? result.rows[0].player_two : result.rows[0].player_one;
  try { await ctx.telegram.sendMessage(other, 'Lượt ghép đối đầu #' + matchId + ' đã kết thúc.'); } catch {}
  return editOrReply(ctx, 'Đã kết thúc lượt ghép đối đầu #' + escapeHtml(matchId) + '.', homeKeyboard(userId));
}

async function openMemberSection(ctx, action) {
  const userId = String(ctx.from.id);
  const user = await getUser(userId, [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '), ctx.from.username);
  if (action === 'home') {
    pendingInputs.delete(userId);
    return editOrReply(ctx, await welcomeText(ctx, userId, user), mainMenu(userId));
  }
  if (action === 'live') return showLive(ctx, userId);
  if (action === 'tools') return showCatalog(ctx, userId, 'tools', '🧰 HỆ THỐNG THUÊ TOOL AUTOMATION');
  if (action === 'codes') return showCatalog(ctx, userId, 'codes', '🎁 MUA LÌ XÌ · CODE MÀN · CODE TELE');
  if (action === 'otp') return showCatalog(ctx, userId, 'otp', '⚙️ TIỆN ÍCH OTP & INFRA PROXY');
  if (action === 'viptools') return showCatalog(ctx, userId, 'viptools', '🏆 VIP KHO CÔNG CỤ ĐẶC QUYỀN');
  if (action === 'wallet') {
    setPending(userId, { type:'wallet', expiresAt:Date.now()+INPUT_TTL_MS });
    return editOrReply(ctx, '💳 <b>CỔNG NẠP TIỀN</b>\nSố dư hiện tại: <b>' + money(user.balance) + '</b>\nNhập số tiền muốn nạp, ví dụ <code>50000</code>. Tối thiểu 10.000 VNĐ.', homeKeyboard(userId));
  }
  if (action === 'deposit-history') {
    const rows = await pool.query("SELECT amount,reference_code,status,created_at FROM transactions WHERE user_id=$1 AND type='DEPOSIT' ORDER BY created_at DESC LIMIT 10", [userId]);
    const lines = ['💳 <b>LỊCH SỬ NẠP TIỀN</b>'];
    if (!rows.rowCount) lines.push('Chưa có giao dịch nạp tiền.');
    for (const item of rows.rows) lines.push('• +' + money(item.amount) + ' · ' + escapeHtml(item.reference_code) + ' · ' + dateText(item.created_at));
    return editOrReply(ctx, lines.join('\n'), homeKeyboard(userId));
  }
  if (action === 'customer') return showCustomer(ctx, userId);
  if (action === 'orders') {
    const rows = await listOrders(userId, 10);
    const lines = ['🧾 <b>LỊCH SỬ ĐƠN HÀNG</b>'];
    if (!rows.length) lines.push('Bạn chưa có đơn hàng.');
    for (const item of rows) lines.push('• ' + escapeHtml(item.product_name) + ' — ' + money(item.amount) + ' · ' + escapeHtml(item.status) + ' · ' + dateText(item.created_at));
    return editOrReply(ctx, lines.join('\n'), homeKeyboard(userId));
  }
  if (action === 'duel') return showDuel(ctx, userId);
  if (action === 'duel-leave') {
    const result = await pool.query("UPDATE matchmaking_queue SET status='cancelled',updated_at=NOW() WHERE user_id=$1 AND status='waiting' RETURNING id", [userId]);
    return editOrReply(ctx, result.rowCount ? 'Đã rời hàng chờ ghép đối đầu.' : 'Bạn hiện không có lượt chờ.', homeKeyboard(userId));
  }
  if (action === 'ref') {
    const [count,reward,settings] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS total FROM users WHERE ref_by=$1',[userId]),
      pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM wallet_ledger WHERE user_id=$1 AND transaction_type='REFERRAL_REWARD'",[userId]),
      getSettings(['referral_commission_percent'])
    ]);
    let username = String(process.env.BOT_USERNAME || '').replace(/^@/,'');
    if (!username) { try { username = (await ctx.telegram.getMe()).username || ''; } catch {} }
    const link = username ? 'https://t.me/' + username + '?start=ref_' + userId : '';
    const rows = [];
    if (link) rows.push([urlButton('📤 MỞ LINK GIỚI THIỆU',link,'success')]);
    rows.push([callbackButton('🏠 MENU CHÍNH','member:home','primary')]);
    return editOrReply(ctx, '🎊 <b>GIỚI THIỆU REF</b>\nThành viên đã mời: <b>' + count.rows[0].total + '</b>\nHoa hồng đã nhận: <b>' + money(reward.rows[0].total) + '</b>\nTỷ lệ hiện tại: <b>' + Number(settings.referral_commission_percent || 0) + '%</b>\n' + (link ? '<code>' + escapeHtml(link) + '</code>' : 'Chưa xác định username bot.'), inlineKeyboard(rows));
  }
  if (action === 'vip') {
    const products = await listCatalog('vip');
    const level = Number(user.vip_level || 0);
    const thresholds = [0,500000,2000000,5000000];
    const rows = products.map(item => [callbackButton(item.name + ' · ' + money(item.price),'member:order:' + item.id,'success')]);
    rows.push([callbackButton('🏠 MENU CHÍNH','member:home','primary')]);
    return editOrReply(ctx, '👑 <b>TRUNG TÂM VIP</b>\nCấp hiện tại: <b>VIP ' + level + '</b>\nTổng nạp: <b>' + money(user.total_deposited) + '</b>\nMốc tiếp theo: <b>' + (level >= 3 ? 'Cấp tối đa' : money(thresholds[level+1])) + '</b>', inlineKeyboard(rows));
  }
  if (action === 'group' || action === 'news') {
    const key = action === 'group' ? 'GROUP_URL' : 'CHANNEL_URL';
    const settings = await getSettings([key]);
    const raw = settings[key] || process.env[key] || '';
    let url = null;
    try { const parsed = new URL(raw); if (parsed.protocol === 'https:') url = parsed.toString(); } catch {}
    if (!url) return editOrReply(ctx, '⚠️ Admin chưa cấu hình liên kết ' + key + '.', homeKeyboard(userId));
    return editOrReply(ctx, '🔗 <b>' + (action === 'group' ? 'NHÓM CHAT' : 'KÊNH THÔNG BÁO') + '</b>', inlineKeyboard([
      [urlButton(action === 'group' ? '🗣️ MỞ NHÓM CHAT' : '📢 MỞ KÊNH',url,'primary')],
      [callbackButton('🏠 MENU CHÍNH','member:home','primary')]
    ]));
  }
  if (action === 'gift') {
    setPending(userId, { type:'giftcode', expiresAt:Date.now()+INPUT_TTL_MS });
    return editOrReply(ctx, '🎟️ Vui lòng nhập mã Giftcode trong vòng 10 phút.', homeKeyboard(userId));
  }
  if (action === 'support') {
    setPending(userId, { type:'support', expiresAt:Date.now()+INPUT_TTL_MS });
    return editOrReply(ctx, '🧑‍💻 Hãy mô tả vấn đề cần hỗ trợ. Bot sẽ tạo ticket và gửi thông tin cho Admin.', homeKeyboard(userId));
  }
  if (action === 'link-new') {
    const rows = ALLOWED_BRANDS.map(brand => [callbackButton(brand,'member:select-brand:' + brand,'primary')]);
    rows.push([callbackButton('❌ HỦY BỎ','member:home','danger')]);
    return editOrReply(ctx, '👉 Vui lòng chọn hệ thống muốn liên kết:', inlineKeyboard(rows));
  }
  if (action === 'admin-unavailable') return editOrReply(ctx,'⚠️ Hãy cấu hình MINI_APP_URL trong Render Environment.',homeKeyboard(userId));
  return editOrReply(ctx,'Chức năng không hợp lệ. Hãy chọn lại menu chính.',mainMenu(userId));
}

async function handlePending(ctx, next, bot) {
  const userId = String(ctx.from.id);
  const state = pendingInputs.get(userId);
  if (!state || Date.now() > state.expiresAt) {
    pendingInputs.delete(userId);
    return next();
  }
  const input = String(ctx.message.text || '').trim();
  if (!input || input.startsWith('/')) return next();

  if (state.type === 'wallet') {
    if (!/^\d{4,12}$/.test(input)) return ctx.reply('Nhập số tiền bằng chữ số, ví dụ 50000.');
    pendingInputs.delete(userId);
    const amount = Number(input);
    if (amount < 10000 || amount > 500000000) return ctx.reply('Số tiền nạp phải từ 10.000 đến 500.000.000 VNĐ.');
    const settings = await getSettings(['VIETQR_BANK_ID','VIETQR_ACCOUNT_NO','VIETQR_ACCOUNT_NAME']);
    const bank = settings.VIETQR_BANK_ID || process.env.VIETQR_BANK_ID || '';
    const account = settings.VIETQR_ACCOUNT_NO || process.env.VIETQR_ACCOUNT_NO || '';
    const holder = settings.VIETQR_ACCOUNT_NAME || process.env.VIETQR_ACCOUNT_NAME || '';
    if (!bank || !account || !holder) return editOrReply(ctx,'Admin chưa cấu hình VietQR. Vui lòng liên hệ CSKH.',homeKeyboard(userId));
    const image = [encodeURIComponent(bank),encodeURIComponent(account),'compact2.png'].join('-');
    const params = new URLSearchParams({amount:String(amount),addInfo:'NAP ' + userId,accountName:holder});
    const qr = 'https://img.vietqr.io/image/' + image + '?' + params.toString();
    const caption = '💳 <b>THÔNG TIN NẠP TIỀN</b>\nSố tiền: <b>' + money(amount) + '</b>\nNgân hàng: ' + escapeHtml(bank) + '\nSố tài khoản: <code>' + escapeHtml(account) + '</code>\nChủ tài khoản: <b>' + escapeHtml(holder) + '</b>\nNội dung: <code>NAP ' + userId + '</code>\nTrạng thái: Chờ đối soát.';
    const markup = inlineKeyboard([[callbackButton('🔄 LỊCH SỬ NẠP','member:deposit-history','primary')],[callbackButton('🏠 MENU CHÍNH','member:home','primary')]]);
    try { return await ctx.replyWithPhoto(qr,{caption,parse_mode:'HTML',...markup}); }
    catch { return editOrReply(ctx,caption,markup); }
  }

  if (state.type === 'link_username') {
    if (input.length < 3 || input.length > 64 || /[\u0000-\u001f]/.test(input)) return ctx.reply('Tên đăng nhập phải từ 3 đến 64 ký tự. Không gửi mật khẩu/OTP.');
    await pool.query('INSERT INTO linked_accounts (user_id,brand,username) VALUES ($1,$2,$3) ON CONFLICT (user_id,brand,username) DO NOTHING',[userId,state.brand,input]);
    pendingInputs.delete(userId);
    return ctx.reply('🎉 Đã liên kết ' + escapeHtml(state.brand) + ' · <code>' + escapeHtml(input) + '</code>.',{parse_mode:'HTML',...homeKeyboard(userId)});
  }

  if (state.type === 'giftcode') {
    pendingInputs.delete(userId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT * FROM giftcodes WHERE code=$1 FOR UPDATE',[input.toUpperCase()]);
      if (!found.rowCount) throw new Error('Giftcode không tồn tại.');
      const gift = found.rows[0];
      if (!gift.is_active || (gift.expires_at && new Date(gift.expires_at) < new Date())) throw new Error('Giftcode đã hết hạn hoặc bị khóa.');
      if (Number(gift.redeemed_count) >= Number(gift.max_redemptions)) throw new Error('Giftcode đã hết lượt.');
      const inserted = await client.query('INSERT INTO giftcode_redemptions (code,user_id,reward_amount) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING code',[gift.code,userId,gift.reward_amount]);
      if (!inserted.rowCount) throw new Error('Bạn đã sử dụng giftcode này rồi.');
      const reward = Number(gift.reward_amount);
      if (reward > 0) {
        await client.query('UPDATE users SET balance=balance+$1 WHERE user_id=$2',[reward,userId]);
        await client.query("INSERT INTO wallet_ledger (reference_code,user_id,amount,transaction_type,description) VALUES ($1,$2,$3,'GIFTCODE',$4)",['giftcode:' + gift.code + ':' + userId,userId,reward,'Nhận thưởng giftcode ' + gift.code]);
        await client.query("INSERT INTO transactions (user_id,amount,type,reference_code,status) VALUES ($1,$2,'GIFTCODE',$3,'paid')",[userId,reward,gift.code]);
      }
      await client.query('UPDATE giftcodes SET redeemed_count=redeemed_count+1 WHERE code=$1',[gift.code]);
      await client.query('COMMIT');
      return ctx.reply('🎉 Kích hoạt Giftcode thành công. Ví được cộng <b>' + money(reward) + '</b>.',{parse_mode:'HTML',...homeKeyboard(userId)});
    } catch (error) {
      await client.query('ROLLBACK');
      return ctx.reply('❌ Giftcode không hợp lệ: ' + escapeHtml(error.message),{parse_mode:'HTML',...homeKeyboard(userId)});
    } finally { client.release(); }
  }

  if (state.type === 'support') {
    pendingInputs.delete(userId);
    if (input.length < 5) return ctx.reply('Nội dung cần ít nhất 5 ký tự. Hãy mở CSKH để gửi lại.');
    const result = await pool.query("INSERT INTO support_tickets (user_id,subject,message) VALUES ($1,$2,$3) RETURNING id",[userId,'Yêu cầu hỗ trợ Telegram',input.slice(0,3000)]);
    const ticketId = result.rows[0].id;
    if (ADMIN_ID) {
      try { await bot.telegram.sendMessage(ADMIN_ID,'🆕 YÊU CẦU CSKH #' + ticketId + '\nTelegram ID: ' + userId + '\nNội dung:\n' + input.slice(0,2500)); } catch {}
    }
    return ctx.reply('✅ Đã tạo yêu cầu hỗ trợ #' + ticketId + '. CSKH sẽ phản hồi qua Telegram.',homeKeyboard(userId));
  }
  return next();
}

function setupBotClient(bot) {
  bot.start(async ctx => {
    const userId = String(ctx.from.id);
    const payload = String(ctx.startPayload || '');
    const ref = payload.startsWith('ref_') ? payload.slice(4) : '';
    const refBy = /^\d{5,20}$/.test(ref) && ref !== userId ? ref : null;
    const user = await getUser(userId,[ctx.from.first_name,ctx.from.last_name].filter(Boolean).join(' '),ctx.from.username,refBy);
    pendingInputs.delete(userId);
    await ctx.reply(await welcomeText(ctx,userId,user),mainMenu(userId));
  });

  bot.command('menu', async ctx => {
    const userId=String(ctx.from.id);
    const user=await getUser(userId,[ctx.from.first_name,ctx.from.last_name].filter(Boolean).join(' '),ctx.from.username);
    await ctx.reply(await welcomeText(ctx,userId,user),mainMenu(userId));
  });

  bot.command('help', async ctx => ctx.reply('/start - Menu chính\n/menu - Hiển thị menu\n/admin - Bảng điều khiển Admin\n/help - Hướng dẫn'));

  bot.command('admin', async ctx => {
    const userId=String(ctx.from.id);
    if (!ADMIN_ID || userId!==ADMIN_ID) return ctx.reply('⛔ Bạn không có quyền quản trị.');
    const url=getMiniAppUrl('admin');
    if (!url) return ctx.reply('⚠️ Hãy cấu hình MINI_APP_URL trong Render Environment.');
    return ctx.reply('🛡️ Bảng điều khiển dành cho quản trị viên:',{...inlineKeyboard([[webAppButton('🛡️ MỞ BẢNG ĐIỀU KHIỂN ADMIN',url,'primary')]])});
  });

  bot.action(/^member:(.+)$/, async ctx => {
    const userId=String(ctx.from.id);
    const last=cooldowns.get(userId)||0;
    if (Date.now()-last<300) { await ctx.answerCbQuery().catch(()=>{}); return; }
    cooldowns.set(userId,Date.now());
    await ctx.answerCbQuery().catch(()=>{});
    const action=String(ctx.match[1]||'');
    try {
      if (action.startsWith('order:')) {
        const order=await createMemberOrder(userId,action.slice('order:'.length));
        return editOrReply(ctx,'✅ <b>ĐÃ TẠO ĐƠN HÀNG</b>\nSản phẩm: <b>'+escapeHtml(order.product_name)+'</b>\nMã đơn: <code>'+escapeHtml(order.order_code)+'</code>\nSố tiền: '+money(order.amount)+'\nTrạng thái: Chờ Admin xử lý.\nSố dư còn lại: '+money(order.balance),inlineKeyboard([[callbackButton('🧾 LỊCH SỬ ĐƠN HÀNG','member:orders','primary')],[callbackButton('🏠 MENU CHÍNH','member:home','primary')]]));
      }
      if (action.startsWith('select-brand:')) {
        const brand=action.slice('select-brand:'.length).toUpperCase();
        if (!ALLOWED_BRANDS.includes(brand)) throw new Error('Thương hiệu không hợp lệ.');
        setPending(userId,{type:'link_username',brand,expiresAt:Date.now()+INPUT_TTL_MS});
        return editOrReply(ctx,'✍️ Đã chọn <b>'+escapeHtml(brand)+'</b>. Hãy nhập tên đăng nhập; không gửi mật khẩu/OTP.',inlineKeyboard([[callbackButton('❌ HỦY','member:home','danger')]]));
      }
      if (action.startsWith('link-delete:')) {
        const id=action.slice('link-delete:'.length);
        if (!/^\d{1,18}$/.test(id)) throw new Error('ID tài khoản không hợp lệ.');
        await pool.query('DELETE FROM linked_accounts WHERE id=$1 AND user_id=$2',[id,userId]);
        return openMemberSection(ctx,'live');
      }
      if (action.startsWith('duel-finish:')) {
        const id=action.slice('duel-finish:'.length);
        const result=await pool.query("UPDATE matchmaking_matches SET status='completed',finished_at=NOW() WHERE id=$1 AND status='matched' AND (player_one=$2 OR player_two=$2) RETURNING player_one,player_two",[id,userId]);
        if (!result.rowCount) throw new Error('Không tìm thấy lượt ghép đang hoạt động.');
        await pool.query("UPDATE matchmaking_queue SET status='completed',updated_at=NOW() WHERE match_id=$1",[id]);
        const other=result.rows[0].player_one===userId?result.rows[0].player_two:result.rows[0].player_one;
        try { await ctx.telegram.sendMessage(other,'Lượt ghép đối đầu #'+id+' đã kết thúc.'); } catch {}
        return editOrReply(ctx,'Đã kết thúc lượt ghép đối đầu #'+escapeHtml(id)+'.',homeKeyboard(userId));
      }
      if (action==='duel-leave') {
        await pool.query("UPDATE matchmaking_queue SET status='cancelled',updated_at=NOW() WHERE user_id=$1 AND status='waiting'",[userId]);
        return editOrReply(ctx,'Đã rời hàng chờ ghép đối đầu.',homeKeyboard(userId));
      }
      return openMemberSection(ctx,action);
    } catch(error) {
      console.error('Lỗi xử lý menu thành viên:',error.message);
      return editOrReply(ctx,'❌ '+escapeHtml(error.message||'Không thể xử lý yêu cầu.'),homeKeyboard(userId));
    }
  });

  bot.on('text',async (ctx,next)=>{
    try { return await handlePending(ctx,next,bot); }
    catch(error) {
      console.error('Lỗi xử lý nội dung thành viên:',error.message);
      return ctx.reply('Không thể xử lý nội dung. Vui lòng thử lại hoặc mở /menu.');
    }
  });
}

module.exports={setupBotClient,mainMenu,homeKeyboard,getMiniAppUrl};
