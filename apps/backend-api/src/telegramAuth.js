const crypto = require('crypto');

function safeCompare(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validateTelegramInitData(initData, botToken) {
  if (!initData || typeof initData !== 'string' || initData.length > 8192) {
    throw new Error('Thiếu dữ liệu xác thực Telegram.');
  }
  if (!botToken) throw new Error('Bot token chưa được cấu hình.');
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new Error('Chữ ký Telegram không hợp lệ.');
  }
  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  const maxAge = Math.max(60, Number(process.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS || 86400));
  if (!Number.isFinite(authDate) || authDate > now + 60 || now - authDate > maxAge) {
    throw new Error('Phiên Telegram đã hết hạn. Hãy mở lại ứng dụng từ bot.');
  }
  const dataCheckString = Array.from(params.entries())
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + '=' + value)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!safeCompare(calculatedHash, receivedHash.toLowerCase())) {
    throw new Error('Không thể xác minh chữ ký Telegram.');
  }
  let user;
  try {
    user = JSON.parse(params.get('user') || '{}');
  } catch {
    throw new Error('Dữ liệu người dùng Telegram không hợp lệ.');
  }
  if (!user || !/^\d{5,20}$/.test(String(user.id || ''))) {
    throw new Error('Không tìm thấy Telegram user ID hợp lệ.');
  }
  return user;
}

function authenticateTelegram(req, res, next) {
  try {
    const authHeader = req.get('authorization') || '';
    const initData = authHeader.startsWith('tma ')
      ? authHeader.slice(4)
      : (req.get('x-telegram-init-data') || '');
    req.telegramUser = validateTelegramInitData(initData, process.env.BOT_TOKEN || '');
    req.isAdmin = String(req.telegramUser.id) === String(process.env.ADMIN_ID || '');
    next();
  } catch (error) {
    res.status(401).json({ error: error.message || 'Yêu cầu xác thực Telegram.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: 'Bạn không có quyền quản trị.' });
  next();
}

module.exports = { validateTelegramInitData, authenticateTelegram, requireAdmin };
