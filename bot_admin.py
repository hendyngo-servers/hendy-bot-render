import os
import logging
import asyncio
import asyncpg
import requests
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ApplicationBuilder, CallbackQueryHandler, CommandHandler, MessageHandler, filters, ContextTypes

logging.basicConfig(format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO)

# ================= CẤU HÌNH =================
BOT2_TOKEN = os.getenv("BOT2_TOKEN", "8864632779:AAHX6grIi3yat-Ak7kYTUyJeRDE1ZggJ3eI")
BOT1_TOKEN = os.getenv("BOT1_TOKEN", "8689114890:AAFBFM0rNtZWpOtAovIPHPVQTJVp0odU1DQ")
ADMIN_ID = os.getenv("ADMIN_ID", "6138197737")
WORKER_URL = os.getenv("WORKER_URL", "https://your-worker-url.workers.dev")
DATABASE_URL = os.getenv("DATABASE_URL")

admin_states = {}
db_pool = None

# ================= QUẢN LÝ DATABASE (ASYNCPG) =================
async def init_db_pool():
    global db_pool
    db_pool = await asyncpg.create_pool(DATABASE_URL)

async def get_all_users():
    async with db_pool.acquire() as conn:
        return await conn.fetch("SELECT user_id as id, name, balance FROM users")

async def get_user(user_id):
    async with db_pool.acquire() as conn:
        return await conn.fetchrow("SELECT user_id as id, name, balance FROM users WHERE user_id = $1", str(user_id))

async def update_balance(user_id, amount, is_add=True, is_reset=False):
    async with db_pool.acquire() as conn:
        if is_reset:
            await conn.execute("UPDATE users SET balance = 0 WHERE user_id = $1", str(user_id))
        else:
            if is_add:
                await conn.execute("UPDATE users SET balance = balance + $1 WHERE user_id = $2", float(amount), str(user_id))
            else:
                await conn.execute("UPDATE users SET balance = GREATEST(0, balance - $1) WHERE user_id = $2", float(amount), str(user_id))

async def delete_user(user_id):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM users WHERE user_id = $1", str(user_id))

async def notify_user_via_bot1(chat_id, text):
    url = f"https://api.telegram.org/bot{BOT1_TOKEN}/sendMessage"
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
    try:
        # Dùng asyncio.to_thread để không block event loop
        await asyncio.to_thread(requests.post, url, json=payload, timeout=5)
    except Exception as e:
        logging.error(f"Lỗi gửi thông báo: {e}")

async def send_command_to_worker(action_type):
    try:
        payload = {"action": action_type, "target": "ALL"}
        res = await asyncio.to_thread(requests.post, f"{WORKER_URL}/api/command", json=payload, timeout=5)
        return res.status_code == 200
    except Exception as e:
        logging.error(f"Lỗi kết nối Worker: {e}")
        return False

# ================= GIAO DIỆN & LOGIC ADMIN =================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_user.id)
    if chat_id != ADMIN_ID: return
    
    keyboard = [
        [InlineKeyboardButton("⚡ ĐIỀU KHIỂN TỰ ĐỘNG MMO", callback_data="admin_mmo_menu")],
        [InlineKeyboardButton("👥 QUẢN LÝ USER", callback_data="admin_list_users")],
        [InlineKeyboardButton("📢 GỬI BROADCAST", callback_data="admin_broadcast_prompt"), InlineKeyboardButton("🔗 ĐỔI LINK", callback_data="admin_changelink_prompt")]
    ]
    msg = "👑 *BẢNG ĐIỀU KHIỂN ADMIN TỐI CAO*\nHệ thống quản lý tích hợp sẵn sàng."
    if update.message:
        await update.message.reply_text(msg, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    else:
        await update.callback_query.edit_message_text(msg, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    chat_id = str(query.from_user.id)
    if chat_id != ADMIN_ID: return
    data = query.data

    if data == "admin_mmo_menu":
        keyboard = [
            [InlineKeyboardButton("🔍 Quét Live/Die", callback_data="mmo_BULK_CHECK_LIVE"), InlineKeyboardButton("🛑 DỪNG AUTO", callback_data="mmo_STOP_ALL_TASKS")],
            [InlineKeyboardButton("◀ Quay lại Trang chủ", callback_data="back_start")]
        ]
        await query.edit_message_text("⚡ *ĐIỀU KHIỂN MMO*", reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

    elif data.startswith("mmo_"):
        action = data.replace("mmo_", "")
        success = await send_command_to_worker(action)
        if success:
            await query.answer(f"✅ Đã gửi lệnh: {action}", show_alert=True)
        else:
            await query.answer("❌ Lỗi: Không thể kết nối tới Cloudflare Worker!", show_alert=True)

    elif data == "admin_list_users":
        users = await get_all_users()
        keyboard = [[InlineKeyboardButton(f"👤 {u['name']} - {u['balance']:,.0f}đ", callback_data=f"admin_view_{u['id']}")] for u in users]
        keyboard.append([InlineKeyboardButton("◀ Quay lại", callback_data="back_start")])
        await query.edit_message_text(f"👥 *DANH SÁCH ({len(users)})*", reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

    elif data.startswith("admin_view_"):
        target_id = data.replace("admin_view_", "")
        user = await get_user(target_id)
        if not user: return
        
        detail_msg = f"📋 *USER:* {user['name']}\nID: `{user['id']}`\nVí: `{user['balance']:,.0f} VNĐ`"
        keyboard = [
            [InlineKeyboardButton("➕ Cộng 50k", callback_data=f"admin_add_50000_{target_id}"), InlineKeyboardButton("➖ Trừ 50k", callback_data=f"admin_sub_50000_{target_id}")],
            [InlineKeyboardButton("🔄 Reset 0đ", callback_data=f"admin_reset_{target_id}"), InlineKeyboardButton("🗑️ Xóa", callback_data=f"admin_delete_{target_id}")],
            [InlineKeyboardButton("◀ Danh sách User", callback_data="admin_list_users")]
        ]
        await query.edit_message_text(detail_msg, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

    elif data.startswith(("admin_add_", "admin_sub_", "admin_reset_", "admin_delete_")):
        parts = data.split('_')
        action, target_id = parts[1], parts[2] if action in ["reset", "delete"] else parts[3]
        
        if action == "delete":
            await delete_user(target_id)
            await query.edit_message_text("🗑️ Đã xóa user thành công.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀", callback_data="admin_list_users")]]))
        elif action == "reset":
            await update_balance(target_id, 0, is_reset=True)
            await query.edit_message_text("🔄 Đã reset ví về 0đ.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀", callback_data=f"admin_view_{target_id}")]]))
        elif action in ["add", "sub"]:
            amount = int(parts[2])
            await update_balance(target_id, amount, is_add=(action == "add"))
            await query.edit_message_text("✅ Đã cập nhật số dư.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀", callback_data=f"admin_view_{target_id}")]]))

    elif data == "admin_broadcast_prompt":
        admin_states[chat_id] = "waiting_broadcast"
        await query.edit_message_text("📢 Nhập nội dung thông báo:", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀", callback_data="back_start")]]))
    
    elif data == "back_start":
        await start(update, context)

async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_user.id)
    if chat_id != ADMIN_ID or chat_id not in admin_states: return
    
    current_state = admin_states.pop(chat_id)
    text = update.message.text.strip()

    if current_state == "waiting_broadcast":
        users = await get_all_users()
        for u in users:
            await notify_user_via_bot1(u['id'], f"📢 *THÔNG BÁO*\n\n{text}")
        await update.message.reply_text(f"✅ Đã gửi thông báo đến {len(users)} khách hàng!")

async def main():
    await init_db_pool()
    app = ApplicationBuilder().token(BOT2_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(button_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    
    print("🤖 Admin Bot Started!")
    await app.initialize()
    await app.start()
    await app.updater.start_polling()
    
    # Giữ event loop chạy
    while True: await asyncio.sleep(3600)

if __name__ == "__main__":
    asyncio.run(main())
