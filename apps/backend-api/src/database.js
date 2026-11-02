const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('Thiếu DATABASE_URL. Hãy cấu hình PostgreSQL trong biến môi trường.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (error) => {
  console.error('Lỗi kết nối PostgreSQL không mong đợi:', error.message);
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '',
      balance NUMERIC(18, 0) NOT NULL DEFAULT 0,
      total_deposited NUMERIC(18, 0) NOT NULL DEFAULT 0,
      vip_level INTEGER NOT NULL DEFAULT 0,
      ref_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount NUMERIC(18, 0) NOT NULL,
      type TEXT NOT NULL,
      reference_code TEXT,
      status TEXT NOT NULL DEFAULT 'paid',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS deposit_events (
      reference_code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount NUMERIC(18, 0) NOT NULL CHECK (amount > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_user_created
      ON transactions (user_id, created_at DESC);
  `);

  // Upgrade REAL currency columns from the previous schema to exact integer VND.
  await pool.query(`
    DO $migration$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'users'
          AND column_name = 'balance'
          AND data_type IN ('real', 'double precision')
      ) THEN
        ALTER TABLE users
          ALTER COLUMN balance TYPE NUMERIC(18, 0)
          USING COALESCE(ROUND(balance::numeric), 0);
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'users'
          AND column_name = 'total_deposited'
          AND data_type IN ('real', 'double precision')
      ) THEN
        ALTER TABLE users
          ALTER COLUMN total_deposited TYPE NUMERIC(18, 0)
          USING COALESCE(ROUND(total_deposited::numeric), 0);
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'transactions'
          AND column_name = 'amount'
          AND data_type IN ('real', 'double precision')
      ) THEN
        ALTER TABLE transactions
          ALTER COLUMN amount TYPE NUMERIC(18, 0)
          USING COALESCE(ROUND(amount::numeric), 0);
      END IF;
    END $migration$;

    UPDATE users
    SET balance = COALESCE(balance, 0),
        total_deposited = COALESCE(total_deposited, 0)
    WHERE balance IS NULL OR total_deposited IS NULL;

    ALTER TABLE users ALTER COLUMN balance SET DEFAULT 0;
    ALTER TABLE users ALTER COLUMN balance SET NOT NULL;
    ALTER TABLE users ALTER COLUMN total_deposited SET DEFAULT 0;
    ALTER TABLE users ALTER COLUMN total_deposited SET NOT NULL;
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('minigame','tools','codes','otp','proxy','vip')),
      description TEXT NOT NULL DEFAULT '',
      price NUMERIC(18, 0) NOT NULL CHECK (price >= 0),
      duration_days INTEGER NOT NULL DEFAULT 0,
      stock INTEGER,
      vip_level INTEGER NOT NULL DEFAULT 0,
      image_url TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      order_code TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      category TEXT NOT NULL,
      amount NUMERIC(18, 0) NOT NULL CHECK (amount >= 0),
      status TEXT NOT NULL DEFAULT 'pending',
      admin_note TEXT NOT NULL DEFAULT '',
      delivery_text TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wallet_ledger (
      id BIGSERIAL PRIMARY KEY,
      reference_code TEXT UNIQUE,
      user_id TEXT NOT NULL,
      amount NUMERIC(18, 0) NOT NULL,
      transaction_type TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS support_tickets (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      admin_reply TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS giftcodes (
      code TEXT PRIMARY KEY,
      reward_amount NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (reward_amount >= 0),
      max_redemptions INTEGER NOT NULL DEFAULT 1 CHECK (max_redemptions > 0),
      redeemed_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS giftcode_redemptions (
      code TEXT NOT NULL REFERENCES giftcodes(code) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      reward_amount NUMERIC(18, 0) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (code, user_id)
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      is_public BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS admin_audit (
      id BIGSERIAL PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_products_category_active ON products(category, is_active);
    CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wallet_user_created ON wallet_ledger(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tickets_user_created ON support_tickets(user_id, created_at DESC);
  `);
  await pool.query(`
    INSERT INTO app_settings (key, value, is_public) VALUES
      ('homepage_title', 'Hendy Bot', TRUE),
      ('announcement', '', TRUE),
      ('VIETQR_BANK_ID', '', TRUE),
      ('VIETQR_ACCOUNT_NO', '', TRUE),
      ('VIETQR_ACCOUNT_NAME', '', TRUE),
      ('GROUP_URL', '', TRUE),
      ('CHANNEL_URL', '', TRUE),
      ('referral_commission_percent', '0', TRUE),
      ('support_message', 'Đội ngũ CSKH sẽ phản hồi trong thời gian sớm nhất.', TRUE)
    ON CONFLICT (key) DO NOTHING
  `);

  console.log('Đã khởi tạo PostgreSQL schema.');
}

async function getUser(userId, name = '', username = '', refBy = null) {
  const result = await pool.query(
    `INSERT INTO users (user_id, name, username, ref_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
       SET name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE users.name END,
           username = CASE WHEN EXCLUDED.username <> '' THEN EXCLUDED.username ELSE users.username END
     RETURNING balance, vip_level, total_deposited`,
    [String(userId), String(name || ''), String(username || ''), refBy]
  );
  return result.rows[0];
}

async function updateBalance(userId, amount, isDeposit = false) {
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Số tiền phải là số nguyên dương hợp lệ.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [String(userId)]
    );

    const result = await client.query(
      `UPDATE users
       SET balance = balance + $1,
           total_deposited = total_deposited + CASE WHEN $2 THEN $1 ELSE 0 END,
           vip_level = CASE
             WHEN NOT $2 THEN vip_level
             WHEN total_deposited + $1 >= 5000000 THEN 3
             WHEN total_deposited + $1 >= 2000000 THEN 2
             WHEN total_deposited + $1 >= 500000 THEN 1
             ELSE 0
           END
       WHERE user_id = $3
       RETURNING balance`,
      [value, Boolean(isDeposit), String(userId)]
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function logTransaction(userId, amount, type, referenceCode, status = 'paid') {
  await pool.query(
    `INSERT INTO transactions (user_id, amount, type, reference_code, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [String(userId), Number(amount), String(type), referenceCode || null, String(status)]
  );
}

async function processDeposit({ userId, amount, referenceCode }) {
  const value = Number(amount);
  const reference = String(referenceCode || '').trim();

  if (!/^\d{5,20}$/.test(String(userId))) {
    throw new Error('Telegram user ID không hợp lệ.');
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Số tiền nạp không hợp lệ.');
  }
  if (!reference || reference.length > 128) {
    throw new Error('Mã tham chiếu giao dịch không hợp lệ.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inserted = await client.query(
      `INSERT INTO deposit_events (reference_code, user_id, amount)
       VALUES ($1, $2, $3)
       ON CONFLICT (reference_code) DO NOTHING
       RETURNING reference_code`,
      [reference, String(userId), value]
    );

    if (inserted.rowCount === 0) {
      await client.query('ROLLBACK');
      return { duplicate: true };
    }

    await client.query(
      `INSERT INTO users (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [String(userId)]
    );

    const updated = await client.query(
      `UPDATE users
       SET balance = balance + $1,
           total_deposited = total_deposited + $1,
           vip_level = CASE
             WHEN total_deposited + $1 >= 5000000 THEN 3
             WHEN total_deposited + $1 >= 2000000 THEN 2
             WHEN total_deposited + $1 >= 500000 THEN 1
             ELSE 0
           END
       WHERE user_id = $2
       RETURNING balance, vip_level, total_deposited`,
      [value, String(userId)]
    );

    await client.query(
      `INSERT INTO transactions (user_id, amount, type, reference_code, status)
       VALUES ($1, $2, 'DEPOSIT', $3, 'paid')`,
      [String(userId), value, reference]
    );
    await client.query(
      `INSERT INTO wallet_ledger (reference_code, user_id, amount, transaction_type, description)
       VALUES ($1, $2, $3, 'DEPOSIT', 'Nạp tiền qua ngân hàng')`,
      ['deposit:' + reference, String(userId), value]
    );
    const referralResult = await client.query(
      'SELECT ref_by FROM users WHERE user_id = $1',
      [String(userId)]
    );
    const rateResult = await client.query(
      "SELECT value FROM app_settings WHERE key = 'referral_commission_percent'"
    );
    const rate = Math.max(0, Math.min(30, Number(rateResult.rows[0] && rateResult.rows[0].value || 0)));
    const referrerId = referralResult.rows[0] && referralResult.rows[0].ref_by;
    const referralReward = Math.floor(value * rate / 100);
    if (referrerId && referralReward > 0) {
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE user_id = $2',
        [referralReward, referrerId]
      );
      await client.query(
        "INSERT INTO wallet_ledger (reference_code, user_id, amount, transaction_type, description) " +
        "VALUES ($1, $2, $3, 'REFERRAL_REWARD', $4)",
        ['referral:' + reference, referrerId, referralReward, 'Hoa hồng giới thiệu từ giao dịch ' + reference]
      );
      await client.query(
        "INSERT INTO transactions (user_id, amount, type, reference_code, status) " +
        "VALUES ($1, $2, 'REFERRAL_REWARD', $3, 'paid')",
        [referrerId, referralReward, reference]
      );
    }

    await client.query('COMMIT');
    return { duplicate: false, user: updated.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function checkDb() {
  await pool.query('SELECT 1');
  return true;
}

async function closeDb() {
  await pool.end();
}

module.exports = {
  initDb,
  getUser,
  updateBalance,
  logTransaction,
  processDeposit,
  checkDb,
  closeDb,
  pool
};
