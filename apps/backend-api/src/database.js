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
  closeDb
};
