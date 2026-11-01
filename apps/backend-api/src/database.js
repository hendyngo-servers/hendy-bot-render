import os
import asyncpg
from datetime import datetime

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://neondb_owner:npg_mRavNEed4h1b@ep-green-water-b3fjpxk7-pooler.c-4.ap-southeast-1.aws.neon.tech")

class Database:
    pool = None

    @classmethod
    async def connect(cls):
        cls.pool = await asyncpg.create_pool(DATABASE_URL)

    @classmethod
    async def close(cls):
        if cls.pool:
            await cls.pool.close()

async def init_db():
    async with Database.pool.acquire() as conn:
        await conn.execute('''CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY, 
            name TEXT, 
            username TEXT, 
            balance REAL DEFAULT 0.0, 
            total_deposited REAL DEFAULT 0.0,
            vip_level INTEGER DEFAULT 0, 
            ref_by TEXT, 
            created_at TEXT
        )''')
        await conn.execute('''CREATE TABLE IF NOT EXISTS transactions (
            id SERIAL PRIMARY KEY, 
            user_id TEXT, 
            amount REAL, 
            type TEXT, 
            reference_code TEXT, 
            status TEXT, 
            created_at TEXT
        )''')

async def get_user(user_id: str, name: str = "", username: str = "", ref_by: str = None):
    async with Database.pool.acquire() as conn:
        row = await conn.fetchrow("SELECT balance, vip_level, total_deposited FROM users WHERE user_id = $1", user_id)
        if not row:
            time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            await conn.execute(
                "INSERT INTO users (user_id, name, username, balance, total_deposited, vip_level, ref_by, created_at) VALUES ($1, $2, $3, 0, 0, 0, $4, $5)", 
                user_id, name, username, ref_by, time_str
            )
            return {"balance": 0.0, "vip_level": 0, "total_deposited": 0.0}
        return dict(row)

async def update_balance(user_id: str, amount: float, is_deposit: bool = False):
    async with Database.pool.acquire() as conn:
        if is_deposit and amount > 0:
            await conn.execute("UPDATE users SET balance = balance + $1, total_deposited = total_deposited + $1 WHERE user_id = $2", amount, user_id)
            # Nâng cấp VIP tự động
            row = await conn.fetchrow("SELECT total_deposited FROM users WHERE user_id = $1", user_id)
            total = row['total_deposited']
            new_vip = 0
            if total >= 5000000: new_vip = 3
            elif total >= 2000000: new_vip = 2
            elif total >= 500000: new_vip = 1
            await conn.execute("UPDATE users SET vip_level = $1 WHERE user_id = $2", new_vip, user_id)
        else:
            await conn.execute("UPDATE users SET balance = balance + $1 WHERE user_id = $2", amount, user_id)

async def log_transaction(user_id: str, amount: float, trans_type: str, ref_code: str, status: str = "paid"):
    time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    async with Database.pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO transactions (user_id, amount, type, reference_code, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
            user_id, amount, trans_type, ref_code, status, time_str
        )
