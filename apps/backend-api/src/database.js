const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_mRavNEed4h1b@ep-green-water-b3fjpxk7-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    ssl: { rejectUnauthorized: false }
});

async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY, name TEXT, username TEXT, 
            balance REAL DEFAULT 0.0, total_deposited REAL DEFAULT 0.0,
            vip_level INTEGER DEFAULT 0, ref_by TEXT, created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id SERIAL PRIMARY KEY, user_id TEXT, amount REAL, type TEXT, 
            reference_code TEXT, status TEXT, created_at TEXT
        );
    `);
    console.log("✅ Đã khởi tạo Database (PostgreSQL)");
}

async function getUser(userId, name = "", username = "", refBy = null) {
    const res = await pool.query("SELECT balance, vip_level, total_deposited FROM users WHERE user_id = $1", [userId]);
    if (res.rows.length === 0) {
        const timeStr = new Date().toISOString();
        await pool.query(
            "INSERT INTO users (user_id, name, username, balance, total_deposited, vip_level, ref_by, created_at) VALUES ($1, $2, $3, 0, 0, 0, $4, $5)",
            [userId, name, username, refBy, timeStr]
        );
        return { balance: 0.0, vip_level: 0, total_deposited: 0.0 };
    }
    return res.rows[0];
}

async function updateBalance(userId, amount, isDeposit = false) {
    if (isDeposit && amount > 0) {
        await pool.query("UPDATE users SET balance = balance + $1, total_deposited = total_deposited + $1 WHERE user_id = $2", [amount, userId]);
        const res = await pool.query("SELECT total_deposited FROM users WHERE user_id = $1", [userId]);
        const total = res.rows[0].total_deposited;
        let newVip = 0;
        if (total >= 5000000) newVip = 3;
        else if (total >= 2000000) newVip = 2;
        else if (total >= 500000) newVip = 1;
        await pool.query("UPDATE users SET vip_level = $1 WHERE user_id = $2", [newVip, userId]);
    } else {
        await pool.query("UPDATE users SET balance = balance + $1 WHERE user_id = $2", [amount, userId]);
    }
}

async function logTransaction(userId, amount, type, refCode, status = "paid") {
    const timeStr = new Date().toISOString();
    await pool.query(
        "INSERT INTO transactions (user_id, amount, type, reference_code, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [userId, amount, type, refCode, status, timeStr]
    );
}

module.exports = { initDb, getUser, updateBalance, logTransaction };
