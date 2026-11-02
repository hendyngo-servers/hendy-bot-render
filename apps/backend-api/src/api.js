const express = require('express');
const crypto = require('crypto');
const { pool, getUser } = require('./database');
const { authenticateTelegram, requireAdmin } = require('./telegramAuth');

const router = express.Router();
const categories = ['minigame', 'tools', 'codes', 'otp', 'proxy', 'vip'];
const allowedStatuses = ['pending', 'processing', 'completed', 'rejected', 'cancelled'];
const settingKeys = [
  'homepage_title', 'announcement', 'VIETQR_BANK_ID', 'VIETQR_ACCOUNT_NO',
  'VIETQR_ACCOUNT_NAME', 'GROUP_URL', 'CHANNEL_URL',
  'referral_commission_percent', 'support_message'
];

function asyncRoute(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}
function parseMoney(value, allowZero) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < (allowZero ? 0 : 1) || amount > 9000000000000000) {
    throw httpError(400, 'Số tiền không hợp lệ.');
  }
  return amount;
}
function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)
    || crypto.randomBytes(4).toString('hex');
}
async function querySettings(keys, publicOnly) {
  const result = publicOnly
    ? await pool.query('SELECT key, value FROM app_settings WHERE key = ANY($1::text[]) AND is_public = TRUE', [keys])
    : await pool.query('SELECT key, value, is_public FROM app_settings WHERE key = ANY($1::text[])', [keys]);
  return result.rows.reduce((out, row) => { out[row.key] = row.value; return out; }, {});
}
async function getPublicSettings() {
  return querySettings(settingKeys, true);
}
async function audit(adminId, action, target, details) {
  await pool.query(
    'INSERT INTO admin_audit (admin_user_id, action, target, details) VALUES ($1, $2, $3, $4::jsonb)',
    [String(adminId), action, String(target || ''), JSON.stringify(details || {})]
  );
}
async function userRow(user) {
  const result = await getUser(
    String(user.id),
    cleanText([user.first_name, user.last_name].filter(Boolean).join(' '), 120),
    cleanText(user.username, 64),
    null
  );
  return {
    id: String(user.id),
    name: cleanText([user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Thành viên', 120),
    username: cleanText(user.username, 64),
    balance: Number(result.balance || 0),
    vipLevel: Number(result.vip_level || 0),
    totalDeposited: Number(result.total_deposited || 0)
  };
}
function publicProduct(row) {
  return {
    id: String(row.id), slug: row.slug, name: row.name, category: row.category,
    description: row.description, price: Number(row.price),
    durationDays: Number(row.duration_days || 0),
    stock: row.stock == null ? null : Number(row.stock),
    vipLevel: Number(row.vip_level || 0), imageUrl: row.image_url || '',
    isActive: Boolean(row.is_active), metadata: row.metadata || {}
  };
}
async function listProducts(category, includeInactive) {
  const conditions = [];
  const values = [];
  if (category && categories.includes(category)) {
    values.push(category);
    conditions.push('category = $' + values.length);
  } else if (category) {
    throw httpError(400, 'Danh mục không hợp lệ.');
  }
  if (!includeInactive) conditions.push('is_active = TRUE');
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const result = await pool.query('SELECT * FROM products' + where + ' ORDER BY category, created_at DESC LIMIT 250', values);
  return result.rows.map(publicProduct);
}

router.use('/api', authenticateTelegram);

router.get('/api/bootstrap', asyncRoute(async (req, res) => {
  const user = await userRow(req.telegramUser);
  const [products, settings, referral] = await Promise.all([
    listProducts(null, false),
    getPublicSettings(),
    pool.query('SELECT COUNT(*)::int AS total FROM users WHERE ref_by = $1', [user.id])
  ]);
  res.json({
    user, isAdmin: Boolean(req.isAdmin), products, settings,
    referralCount: referral.rows[0].total,
    botUsername: process.env.BOT_USERNAME || ''
  });
}));

router.get('/api/products', asyncRoute(async (req, res) => {
  res.json({ products: await listProducts(cleanText(req.query.category, 32) || null, false) });
}));

router.get('/api/me', asyncRoute(async (req, res) => {
  res.json({ user: await userRow(req.telegramUser), isAdmin: Boolean(req.isAdmin) });
}));

router.get('/api/orders', asyncRoute(async (req, res) => {
  const result = await pool.query(
    "SELECT id, order_code, product_name, category, amount, status, admin_note, " +
    "CASE WHEN status = 'completed' THEN delivery_text ELSE '' END AS delivery_text, created_at, updated_at " +
    "FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
    [String(req.telegramUser.id)]
  );
  res.json({ orders: result.rows });
}));

router.post('/api/orders', asyncRoute(async (req, res) => {
  const productId = String(req.body && req.body.productId || '');
  if (!/^\d{1,18}$/.test(productId)) throw httpError(400, 'Sản phẩm không hợp lệ.');
  const client = await pool.connect();
  let order;
  try {
    await client.query('BEGIN');
    const productResult = await client.query('SELECT * FROM products WHERE id = $1 AND is_active = TRUE FOR UPDATE', [productId]);
    if (!productResult.rowCount) throw httpError(404, 'Sản phẩm hiện không còn bán.');
    const product = productResult.rows[0];
    if (product.stock !== null && Number(product.stock) <= 0) throw httpError(409, 'Sản phẩm đã hết hàng.');
    await client.query(
      'INSERT INTO users (user_id, name, username) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING',
      [String(req.telegramUser.id), cleanText(req.telegramUser.first_name, 120), cleanText(req.telegramUser.username, 64)]
    );
    const userResult = await client.query('SELECT balance FROM users WHERE user_id = $1 FOR UPDATE', [String(req.telegramUser.id)]);
    if (!userResult.rowCount || Number(userResult.rows[0].balance) < Number(product.price)) {
      throw httpError(402, 'Số dư không đủ. Vui lòng nạp thêm tiền.');
    }
    const orderCode = 'HD' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
    const balance = await client.query(
      'UPDATE users SET balance = balance - $1 WHERE user_id = $2 RETURNING balance',
      [product.price, String(req.telegramUser.id)]
    );
    const created = await client.query(
      "INSERT INTO orders (order_code, user_id, product_id, product_name, category, amount, status) " +
      "VALUES ($1, $2, $3, $4, $5, $6, 'pending') " +
      "RETURNING id, order_code, product_name, category, amount, status, created_at",
      [orderCode, String(req.telegramUser.id), product.id, product.name, product.category, product.price]
    );
    order = created.rows[0];
    await client.query(
      "INSERT INTO wallet_ledger (reference_code, user_id, amount, transaction_type, description) " +
      "VALUES ($1, $2, $3, 'PURCHASE', $4)",
      ['order:' + orderCode, String(req.telegramUser.id), -Number(product.price), 'Thanh toán đơn ' + orderCode]
    );
    await client.query(
      "INSERT INTO transactions (user_id, amount, type, reference_code, status) VALUES ($1, $2, 'PURCHASE', $3, 'paid')",
      [String(req.telegramUser.id), product.price, orderCode]
    );
    if (product.stock !== null) await client.query('UPDATE products SET stock = stock - 1, updated_at = NOW() WHERE id = $1', [product.id]);
    await client.query('COMMIT');
    order.balance = Number(balance.rows[0].balance);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  res.status(201).json({ order, message: 'Đơn hàng đã được tạo và trừ số dư thành công.' });
}));

router.get('/api/wallet', asyncRoute(async (req, res) => {
  const user = await userRow(req.telegramUser);
  const history = await pool.query(
    'SELECT id, amount, transaction_type, description, reference_code, created_at FROM wallet_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 60',
    [user.id]
  );
  res.json({ balance: user.balance, history: history.rows });
}));

router.get('/api/wallet/payment-info', asyncRoute(async (req, res) => {
  const amount = parseMoney(req.query.amount || 50000, false);
  const settings = await getPublicSettings();
  const bankId = settings.VIETQR_BANK_ID || process.env.VIETQR_BANK_ID || '';
  const accountNo = settings.VIETQR_ACCOUNT_NO || process.env.VIETQR_ACCOUNT_NO || '';
  const accountName = settings.VIETQR_ACCOUNT_NAME || process.env.VIETQR_ACCOUNT_NAME || '';
  if (!bankId || !accountNo || !accountName) return res.status(409).json({ error: 'Quản trị viên chưa cấu hình tài khoản VietQR.' });
  const imagePath = [encodeURIComponent(bankId), encodeURIComponent(accountNo), 'compact2.png'].join('-');
  const params = new URLSearchParams({ amount: String(amount), addInfo: 'NAP ' + String(req.telegramUser.id), accountName });
  res.json({
    amount, accountName, accountNo, bankId,
    transferContent: 'NAP ' + String(req.telegramUser.id),
    qrUrl: 'https://img.vietqr.io/image/' + imagePath + '?' + params.toString()
  });
}));

router.get('/api/referrals', asyncRoute(async (req, res) => {
  const userId = String(req.telegramUser.id);
  const [count, rewards, commission] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM users WHERE ref_by = $1', [userId]),
    pool.query("SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_ledger WHERE user_id = $1 AND transaction_type = 'REFERRAL_REWARD'", [userId]),
    querySettings(['referral_commission_percent'], true)
  ]);
  const botUsername = process.env.BOT_USERNAME || '';
  const referralLink = botUsername ? 'https://t.me/' + botUsername.replace(/^@/, '') + '?start=ref_' + userId : '';
  res.json({
    totalInvited: count.rows[0].total,
    totalReward: Number(rewards.rows[0].total || 0),
    commissionPercent: Number(commission.referral_commission_percent || 0),
    referralLink
  });
}));

router.post('/api/giftcodes/redeem', asyncRoute(async (req, res) => {
  const code = cleanText(req.body && req.body.code, 64).toUpperCase();
  if (!/^[A-Z0-9_-]{4,64}$/.test(code)) throw httpError(400, 'Mã giftcode không hợp lệ.');
  const userId = String(req.telegramUser.id);
  const client = await pool.connect();
  let reward = 0;
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM giftcodes WHERE code = $1 FOR UPDATE', [code]);
    if (!result.rowCount) throw httpError(404, 'Giftcode không tồn tại.');
    const gift = result.rows[0];
    if (!gift.is_active || (gift.expires_at && new Date(gift.expires_at) < new Date())) {
      throw httpError(410, 'Giftcode đã hết hạn hoặc bị khóa.');
    }
    if (Number(gift.redeemed_count) >= Number(gift.max_redemptions)) throw httpError(409, 'Giftcode đã được sử dụng hết lượt.');
    const inserted = await client.query(
      'INSERT INTO giftcode_redemptions (code, user_id, reward_amount) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING code',
      [code, userId, gift.reward_amount]
    );
    if (!inserted.rowCount) throw httpError(409, 'Bạn đã sử dụng giftcode này rồi.');
    reward = Number(gift.reward_amount);
    if (reward > 0) {
      await client.query('UPDATE users SET balance = balance + $1 WHERE user_id = $2', [reward, userId]);
      await client.query(
        "INSERT INTO wallet_ledger (reference_code, user_id, amount, transaction_type, description) VALUES ($1, $2, $3, 'GIFTCODE', $4)",
        ['giftcode:' + code + ':' + userId, userId, reward, 'Nhận thưởng giftcode ' + code]
      );
      await client.query(
        "INSERT INTO transactions (user_id, amount, type, reference_code, status) VALUES ($1, $2, 'GIFTCODE', $3, 'paid')",
        [userId, reward, code]
      );
    }
    await client.query('UPDATE giftcodes SET redeemed_count = redeemed_count + 1 WHERE code = $1', [code]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const user = await userRow(req.telegramUser);
  res.json({ success: true, reward, balance: user.balance, message: reward > 0 ? 'Đã cộng thưởng vào ví của bạn.' : 'Giftcode đã được ghi nhận.' });
}));

router.get('/api/support/tickets', asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT id, subject, message, status, priority, admin_reply, created_at, updated_at FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [String(req.telegramUser.id)]
  );
  res.json({ tickets: result.rows });
}));

router.post('/api/support/tickets', asyncRoute(async (req, res) => {
  const subject = cleanText(req.body && req.body.subject, 120);
  const message = cleanText(req.body && req.body.message, 3000);
  if (subject.length < 3 || message.length < 5) throw httpError(400, 'Vui lòng nhập tiêu đề và nội dung yêu cầu.');
  const result = await pool.query(
    'INSERT INTO support_tickets (user_id, subject, message) VALUES ($1, $2, $3) RETURNING id, subject, message, status, created_at',
    [String(req.telegramUser.id), subject, message]
  );
  res.status(201).json({ ticket: result.rows[0], message: 'Đã gửi yêu cầu hỗ trợ.' });
}));

router.get('/api/vip', asyncRoute(async (req, res) => {
  const user = await userRow(req.telegramUser);
  const products = await listProducts('vip', false);
  res.json({
    currentLevel: user.vipLevel,
    totalDeposited: user.totalDeposited,
    nextThreshold: user.vipLevel >= 3 ? null : [0, 500000, 2000000, 5000000][user.vipLevel + 1],
    products
  });
}));

router.use('/api/admin', requireAdmin);

router.get('/api/admin/overview', asyncRoute(async (req, res) => {
  const [users, products, orders, revenue, tickets] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM users'),
    pool.query('SELECT COUNT(*)::int AS total FROM products WHERE is_active = TRUE'),
    pool.query("SELECT COUNT(*)::int AS total FROM orders WHERE created_at >= NOW() - INTERVAL '30 days'"),
    pool.query("SELECT COALESCE(SUM(amount), 0) AS total FROM orders WHERE status = 'completed'"),
    pool.query("SELECT COUNT(*)::int AS total FROM support_tickets WHERE status IN ('open','processing')")
  ]);
  res.json({
    users: users.rows[0].total,
    activeProducts: products.rows[0].total,
    ordersLast30Days: orders.rows[0].total,
    completedOrderValue: Number(revenue.rows[0].total || 0),
    openTickets: tickets.rows[0].total
  });
}));

router.get('/api/admin/products', asyncRoute(async (req, res) => {
  res.json({ products: await listProducts(cleanText(req.query.category, 32) || null, true) });
}));

router.post('/api/admin/products', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const name = cleanText(body.name, 120);
  const category = cleanText(body.category, 32);
  const description = cleanText(body.description, 1500);
  const price = parseMoney(body.price, true);
  const durationDays = Number(body.durationDays || 0);
  const stock = body.stock === '' || body.stock == null ? null : Number(body.stock);
  const vipLevel = Number(body.vipLevel || 0);
  if (name.length < 2 || !categories.includes(category)) throw httpError(400, 'Tên sản phẩm hoặc danh mục không hợp lệ.');
  if (!Number.isInteger(durationDays) || durationDays < 0 || durationDays > 3650) throw httpError(400, 'Thời hạn không hợp lệ.');
  if (stock !== null && (!Number.isInteger(stock) || stock < 0 || stock > 10000000)) throw httpError(400, 'Tồn kho không hợp lệ.');
  if (!Number.isInteger(vipLevel) || vipLevel < 0 || vipLevel > 3) throw httpError(400, 'Cấp VIP không hợp lệ.');
  const slug = slugify(body.slug || name);
  const imageUrl = cleanText(body.imageUrl, 500);
  if (imageUrl && !/^https:\/\/[^ ]+$/i.test(imageUrl)) throw httpError(400, 'Ảnh sản phẩm phải dùng HTTPS.');
  const result = await pool.query(
    "INSERT INTO products (slug,name,category,description,price,duration_days,stock,vip_level,image_url,is_active) " +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE) RETURNING *",
    [slug,name,category,description,price,durationDays,stock,vipLevel,imageUrl || null]
  );
  await audit(req.telegramUser.id, 'product.create', slug, { category, price });
  res.status(201).json({ product: publicProduct(result.rows[0]) });
}));

router.patch('/api/admin/products/:id', asyncRoute(async (req, res) => {
  if (!/^\d{1,18}$/.test(req.params.id)) throw httpError(400, 'ID sản phẩm không hợp lệ.');
  const old = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (!old.rowCount) throw httpError(404, 'Không tìm thấy sản phẩm.');
  const body = req.body || {};
  const current = old.rows[0];
  const name = body.name === undefined ? current.name : cleanText(body.name, 120);
  const category = body.category === undefined ? current.category : cleanText(body.category, 32);
  const description = body.description === undefined ? current.description : cleanText(body.description, 1500);
  const price = body.price === undefined ? Number(current.price) : parseMoney(body.price, true);
  const durationDays = body.durationDays === undefined ? Number(current.duration_days) : Number(body.durationDays);
  const stock = body.stock === undefined ? current.stock : (body.stock === '' || body.stock == null ? null : Number(body.stock));
  const vipLevel = body.vipLevel === undefined ? Number(current.vip_level) : Number(body.vipLevel);
  const isActive = body.isActive === undefined ? current.is_active : Boolean(body.isActive);
  const imageUrl = body.imageUrl === undefined ? current.image_url : cleanText(body.imageUrl, 500);
  if (name.length < 2 || !categories.includes(category)) throw httpError(400, 'Thông tin sản phẩm không hợp lệ.');
  if (!Number.isInteger(durationDays) || durationDays < 0 || durationDays > 3650) throw httpError(400, 'Thời hạn không hợp lệ.');
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) throw httpError(400, 'Tồn kho không hợp lệ.');
  if (!Number.isInteger(vipLevel) || vipLevel < 0 || vipLevel > 3) throw httpError(400, 'Cấp VIP không hợp lệ.');
  if (imageUrl && !/^https:\/\/[^ ]+$/i.test(imageUrl)) throw httpError(400, 'Ảnh sản phẩm phải dùng HTTPS.');
  const result = await pool.query(
    'UPDATE products SET name=$1,category=$2,description=$3,price=$4,duration_days=$5,stock=$6,vip_level=$7,image_url=$8,is_active=$9,updated_at=NOW() WHERE id=$10 RETURNING *',
    [name,category,description,price,durationDays,stock,vipLevel,imageUrl || null,isActive,req.params.id]
  );
  await audit(req.telegramUser.id, 'product.update', req.params.id, { isActive, category, price });
  res.json({ product: publicProduct(result.rows[0]) });
}));

router.delete('/api/admin/products/:id', asyncRoute(async (req, res) => {
  const result = await pool.query('UPDATE products SET is_active=FALSE,updated_at=NOW() WHERE id=$1 RETURNING id', [req.params.id]);
  if (!result.rowCount) throw httpError(404, 'Không tìm thấy sản phẩm.');
  await audit(req.telegramUser.id, 'product.disable', req.params.id, {});
  res.json({ success: true });
}));

router.get('/api/admin/orders', asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT id,order_code,user_id,product_name,category,amount,status,admin_note,delivery_text,created_at,updated_at FROM orders ORDER BY created_at DESC LIMIT 200'
  );
  res.json({ orders: result.rows });
}));

router.patch('/api/admin/orders/:id', asyncRoute(async (req, res) => {
  const status = cleanText(req.body && req.body.status, 24);
  const adminNote = cleanText(req.body && req.body.adminNote, 1000);
  const deliveryText = cleanText(req.body && req.body.deliveryText, 5000);
  if (!allowedStatuses.includes(status)) throw httpError(400, 'Trạng thái đơn hàng không hợp lệ.');
  const result = await pool.query(
    'UPDATE orders SET status=$1,admin_note=$2,delivery_text=$3,updated_at=NOW() WHERE id=$4 RETURNING *',
    [status,adminNote,deliveryText,req.params.id]
  );
  if (!result.rowCount) throw httpError(404, 'Không tìm thấy đơn hàng.');
  const order = result.rows[0];
  if (status === 'completed' && order.product_id) {
    const product = await pool.query('SELECT vip_level FROM products WHERE id=$1', [order.product_id]);
    if (product.rowCount && Number(product.rows[0].vip_level) > 0) {
      await pool.query('UPDATE users SET vip_level=GREATEST(vip_level,$1) WHERE user_id=$2', [Number(product.rows[0].vip_level),order.user_id]);
    }
  }
  await audit(req.telegramUser.id, 'order.update', order.order_code, { status });
  if (req.app.locals.bot) {
    const notice = status === 'completed'
      ? 'Đơn hàng ' + order.order_code + ' đã hoàn tất.' + (deliveryText ? '\nThông tin bàn giao:\n' + deliveryText : '')
      : 'Đơn hàng ' + order.order_code + ' đã cập nhật trạng thái: ' + status;
    try { await req.app.locals.bot.telegram.sendMessage(order.user_id, notice); }
    catch (error) { console.error('Không gửi được thông báo đơn hàng:', error.message); }
  }
  res.json({ order });
}));

router.get('/api/admin/users', asyncRoute(async (req, res) => {
  const search = cleanText(req.query.search, 80);
  const result = await pool.query(
    'SELECT user_id,name,username,balance,total_deposited,vip_level,ref_by,created_at FROM users ' +
    "WHERE ($1 = '' OR user_id ILIKE $2 OR name ILIKE $2 OR username ILIKE $2) ORDER BY created_at DESC LIMIT 100",
    [search, '%' + search + '%']
  );
  res.json({ users: result.rows.map(row => ({ ...row, balance: Number(row.balance), total_deposited: Number(row.total_deposited) })) });
}));

router.post('/api/admin/users/:id/adjust-balance', asyncRoute(async (req, res) => {
  const amount = parseMoney(req.body && req.body.amount, false);
  const direction = cleanText(req.body && req.body.direction, 12);
  const description = cleanText(req.body && req.body.description, 300);
  if (!['credit','debit'].includes(direction)) throw httpError(400, 'Loại điều chỉnh không hợp lệ.');
  const userId = String(req.params.id);
  if (!/^\d{5,20}$/.test(userId)) throw httpError(400, 'Telegram ID không hợp lệ.');
  const signed = direction === 'credit' ? amount : -amount;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      'UPDATE users SET balance=balance+$1 WHERE user_id=$2 AND balance+$1>=0 RETURNING balance',
      [signed,userId]
    );
    if (!updated.rowCount) throw httpError(409, 'Không tìm thấy tài khoản hoặc số dư không đủ.');
    const ref = 'admin:' + crypto.randomBytes(12).toString('hex');
    await client.query(
      "INSERT INTO wallet_ledger (reference_code,user_id,amount,transaction_type,description) VALUES ($1,$2,$3,'ADMIN_ADJUSTMENT',$4)",
      [ref,userId,signed,description || 'Điều chỉnh số dư bởi quản trị viên']
    );
    await client.query(
      "INSERT INTO transactions (user_id,amount,type,reference_code,status) VALUES ($1,$2,'ADMIN_ADJUSTMENT',$3,'paid')",
      [userId,amount,ref]
    );
    await client.query('COMMIT');
    await audit(req.telegramUser.id, 'user.balance', userId, { amount: signed });
    res.json({ success: true, balance: Number(updated.rows[0].balance) });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.get('/api/admin/tickets', asyncRoute(async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM support_tickets ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 200"
  );
  res.json({ tickets: result.rows });
}));

router.patch('/api/admin/tickets/:id', asyncRoute(async (req, res) => {
  const status = cleanText(req.body && req.body.status, 24);
  const reply = cleanText(req.body && req.body.reply, 3000);
  if (!['open','processing','resolved','closed'].includes(status)) throw httpError(400, 'Trạng thái hỗ trợ không hợp lệ.');
  const result = await pool.query(
    'UPDATE support_tickets SET status=$1,admin_reply=$2,updated_at=NOW() WHERE id=$3 RETURNING *',
    [status,reply,req.params.id]
  );
  if (!result.rowCount) throw httpError(404, 'Không tìm thấy yêu cầu hỗ trợ.');
  await audit(req.telegramUser.id, 'support.reply', req.params.id, { status });
  if (reply && req.app.locals.bot) {
    try { await req.app.locals.bot.telegram.sendMessage(result.rows[0].user_id, '🎧 Phản hồi từ Trung tâm khách hàng:\n' + reply); }
    catch (error) { console.error('Không gửi được phản hồi CSKH:', error.message); }
  }
  res.json({ ticket: result.rows[0] });
}));

router.get('/api/admin/settings', asyncRoute(async (req, res) => {
  res.json({ settings: await querySettings(settingKeys, false) });
}));

router.patch('/api/admin/settings', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const keys = Object.keys(body);
  if (!keys.length || keys.some(key => !settingKeys.includes(key))) {
    throw httpError(400, 'Có khóa cấu hình không được phép cập nhật. Secret hệ thống chỉ quản lý trong Render Environment.');
  }
  const values = {};
  for (const key of keys) {
    const value = cleanText(body[key], 500);
    if (key === 'referral_commission_percent') {
      const percent = Number(value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 30) throw httpError(400, 'Tỷ lệ hoa hồng phải từ 0 đến 30%.');
    }
    if (['GROUP_URL','CHANNEL_URL'].includes(key) && value && !/^https:\/\/[^ ]+$/i.test(value)) {
      throw httpError(400, 'Liên kết nhóm/kênh phải sử dụng HTTPS.');
    }
    values[key] = value;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key,value] of Object.entries(values)) {
      await client.query(
        'INSERT INTO app_settings (key,value,is_public,updated_at) VALUES ($1,$2,TRUE,NOW()) ' +
        'ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,is_public=TRUE,updated_at=NOW()',
        [key,value]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await audit(req.telegramUser.id, 'settings.update', 'public-settings', { keys });
  res.json({ success: true, settings: await querySettings(settingKeys, false) });
}));

router.get('/api/admin/giftcodes', asyncRoute(async (req, res) => {
  const result = await pool.query('SELECT * FROM giftcodes ORDER BY created_at DESC LIMIT 200');
  res.json({ giftcodes: result.rows });
}));

router.post('/api/admin/giftcodes', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const code = cleanText(body.code || crypto.randomBytes(5).toString('hex'), 64).toUpperCase();
  const reward = parseMoney(body.rewardAmount, true);
  const maxRedemptions = Number(body.maxRedemptions || 1);
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (!/^[A-Z0-9_-]{4,64}$/.test(code)) throw httpError(400, 'Mã giftcode chỉ gồm A-Z, số, _ hoặc -.');
  if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100000) throw httpError(400, 'Số lượt sử dụng không hợp lệ.');
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw httpError(400, 'Ngày hết hạn không hợp lệ.');
  const result = await pool.query(
    'INSERT INTO giftcodes (code,reward_amount,max_redemptions,expires_at) VALUES ($1,$2,$3,$4) RETURNING *',
    [code,reward,maxRedemptions,expiresAt]
  );
  await audit(req.telegramUser.id, 'giftcode.create', code, { reward, maxRedemptions });
  res.status(201).json({ giftcode: result.rows[0] });
}));

router.use('/api', (error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('API error:', error.message);
  res.status(error.status || 500).json({
    error: error.status && error.status < 500 ? error.message : 'Lỗi máy chủ. Vui lòng thử lại.'
  });
});

module.exports = router;
