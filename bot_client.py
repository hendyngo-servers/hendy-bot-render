import os
import logging
import asyncio
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from pydantic import BaseModel
import uvicorn
import asyncpg

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo, Update
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    CallbackQueryHandler,
    filters,
)

# ================= CẤU HÌNH HỆ THỐNG =================
logging.basicConfig(format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO)

BOT_TOKEN = os.getenv("8884608128:AAHonVl55GIxT9i6Y0_W7tqrWMcGVVrv088", "YOUR_BOT_TOKEN_HERE")
BOT_USERNAME = os.getenv(" @hendymono_bot:", "YourBotName_bot") # VD: hendy_bot
ADMIN_ID = os.getenv("8639286417", "YOUR_ADMIN_ID_HERE")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://your-mini-app-url.pages.dev")

# Chuỗi kết nối PostgreSQL (Lấy từ Neon.tech)
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://neondb_owner:npg_mRavNEed4h1b@ep-green-water-b3fjpxk7-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require")

user_states = {}  # Lưu trạng thái nhập liệu tạm thời của user
db_pool = None    # Pool kết nối Database toàn cục

# ================= CƠ SỞ DỮ LIỆU POSTGRESQL (ASYNCPG) =================
async def init_db():
    async with db_pool.acquire() as conn:
        await conn.execute('''CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY, 
            name TEXT, username TEXT, 
            balance REAL DEFAULT 0.0, 
            total_deposited REAL DEFAULT 0.0,
            vip_level INTEGER DEFAULT 0,
            ref_by TEXT,
            created_at TEXT
        )''')
        # PostgreSQL dùng SERIAL cho khóa chính tự tăng
        await conn.execute('''CREATE TABLE IF NOT EXISTS transactions (
            id SERIAL PRIMARY KEY, 
            user_id TEXT, amount REAL, type TEXT, reference_code TEXT, 
            status TEXT, created_at TEXT
        )''')

async def get_user(user_id: str, name: str = "", username: str = "", ref_by: str = None):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT balance, vip_level, total_deposited FROM users WHERE user_id = $1", user_id)
        if not row:
            time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            await conn.execute(
                "INSERT INTO users (user_id, name, username, balance, total_deposited, vip_level, ref_by, created_at) VALUES ($1, $2, $3, 0, 0, 0, $4, $5)", 
                user_id, name, username, ref_by, time_str
            )
            return {"balance": 0.0, "vip_level": 0, "total_deposited": 0.0}
        return {"balance": row['balance'], "vip_level": row['vip_level'], "total_deposited": row['total_deposited']}

async def update_balance(user_id: str, amount: float, is_deposit: bool = False):
    async with db_pool.acquire() as conn:
        if is_deposit and amount > 0:
            # Cập nhật số dư và tổng nạp
            await conn.execute("UPDATE users SET balance = balance + $1, total_deposited = total_deposited + $1 WHERE user_id = $2", amount, user_id)
            
            # Logic nâng cấp VIP tự động
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
    async with db_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO transactions (user_id, amount, type, reference_code, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
            user_id, amount, trans_type, ref_code, status, time_str
        )

async def get_ref_stats(user_id: str):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT COUNT(*) FROM users WHERE ref_by = $1", user_id)
        return row['count']

# ================= GIAO DIỆN & MENU =================
def format_money(amount):
    return f"{int(amount):,} VNĐ".replace(",", ".")

def get_home_keyboard(user_id: str):
    keyboard = [
        [
            InlineKeyboardButton('🚀 CODE & API', callback_data='menu:live'),
            InlineKeyboardButton('🧰 APP TOOL (NEW)', callback_data='menu:tools')
        ],
        [InlineKeyboardButton('👁️ DỊCH VỤ MXH (Tăng Mắt/Like)', callback_data='menu:social')],
        [
            InlineKeyboardButton('💳 NẠP TIỀN', callback_data='menu:wallet'),
            InlineKeyboardButton('⚙️ OTP & PROXY', callback_data='menu:otp')
        ],
        [
            InlineKeyboardButton('🎊 GIỚI THIỆU (REF)', callback_data='menu:ref'),
            InlineKeyboardButton('👑 VIP CENTER', callback_data='menu:vip')
        ],
        [
            InlineKeyboardButton('💎 TRUNG TÂM KHÁCH HÀNG', callback_data='menu:customer'),
            InlineKeyboardButton('🧑‍💻 HỖ TRỢ', callback_data='menu:support')
        ]
    ]
    if user_id == ADMIN_ID:
        keyboard.append([InlineKeyboardButton('🛡️ BẢNG ĐIỀU KHIỂN ADMIN', web_app=WebAppInfo(url=WEBAPP_URL))])
    return InlineKeyboardMarkup(keyboard)

def get_back_button():
    return InlineKeyboardMarkup([[InlineKeyboardButton('🏠 QUAY LẠI MENU', callback_data='menu:home')]])

async def send_welcome(update: Update, context: ContextTypes.DEFAULT_TYPE, user_id: str, user_data: dict, name: str):
    text = (
        "🤖 *HENDY CYBERTECH PRO 2026*\n"
        f"Xin chào sếp, *{name}*!\n"
        f"🆔 ID: `{user_id}`\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        f"💰 Số dư: *{format_money(user_data['balance'])}*\n"
        f"👑 Cấp độ: *VIP {user_data['vip_level']}*\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "👉 Chọn dịch vụ bạn muốn sử dụng bên dưới:"
    )
    markup = get_home_keyboard(user_id)
    if update.message:
        await update.message.reply_text(text, parse_mode="Markdown", reply_markup=markup)
    else:
        await update.callback_query.edit_message_text(text, parse_mode="Markdown", reply_markup=markup)

# ================= TELEGRAM BOT HANDLERS =================
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    user_id = str(user.id)
    payload = context.args[0] if context.args else None
    ref_by = payload.replace("ref_", "") if payload and payload.startswith("ref_") else None
    
    # Không cho phép tự ref chính mình
    if ref_by == user_id: ref_by = None 
    
    user_data = await get_user(user_id, user.first_name, user.username, ref_by)
    if user_id in user_states: del user_states[user_id]
    await send_welcome(update, context, user_id, user_data, user.first_name)

async def callback_router(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = str(query.from_user.id)
    data = query.data
    user_data = await get_user(user_id)
    
    if data == "menu:home":
        if user_id in user_states: del user_states[user_id]
        await send_welcome(update, context, user_id, user_data, query.from_user.first_name)

    # ============ NẠP TIỀN ============
    elif data == "menu:wallet":
        text = (
            "💳 *NẠP TIỀN TỰ ĐỘNG 24/7*\n━━━━━━━━━━━━━━━━━━━━\n"
            f"💰 Số dư hiện tại: *{format_money(user_data['balance'])}*\n\n"
            "Chọn mệnh giá nạp nhanh hoặc tự nhập:"
        )
        kb = [
            [InlineKeyboardButton('50K', callback_data='deposit:50000'), InlineKeyboardButton('100K', callback_data='deposit:100000'), InlineKeyboardButton('200K', callback_data='deposit:200000')],
            [InlineKeyboardButton('500K', callback_data='deposit:500000'), InlineKeyboardButton('1 TRIỆU', callback_data='deposit:1000000')],
            [InlineKeyboardButton('✍️ NHẬP SỐ TIỀN KHÁC', callback_data='deposit:custom')],
            [InlineKeyboardButton('🏠 QUAY LẠI', callback_data='menu:home')]
        ]
        await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

    elif data.startswith("deposit:"):
        val = data.split(":")[1]
        if val == "custom":
            user_states[user_id] = {"action": "deposit_custom"}
            await query.edit_message_text("✍️ Vui lòng nhập số tiền bạn muốn nạp (Ví dụ: 150000):", reply_markup=get_back_button())
        else:
            amount = int(val)
            ref_code = f"NAP {user_id}"
            qr_url = f"https://img.vietqr.io/image/VCB-1234567899-compact2.png?amount={amount}&addInfo={ref_code}&accountName=NGUYEN VAN A"
            cap = (
                "🏦 *QUÉT MÃ QR ĐỂ NẠP TIỀN*\n━━━━━━━━━━━━━━━━━━━━\n"
                f"• Số tiền: `{format_money(amount)}`\n"
                f"• Nội dung CK: `{ref_code}` (Bắt buộc)\n\n"
                "⚠️ _Hệ thống tự động cộng tiền sau 1-3 phút._"
            )
            await query.message.delete()
            await context.bot.send_photo(chat_id=user_id, photo=qr_url, caption=cap, parse_mode="Markdown", reply_markup=get_back_button())

    # ============ DỊCH VỤ MXH ============
    elif data == "menu:social":
        text = "👁️ *DỊCH VỤ MẠNG XÃ HỘI*\nChọn nền tảng bạn muốn sử dụng:"
        kb = [
            [InlineKeyboardButton('🎵 TikTok - Tăng Mắt (10K/1k)', callback_data='buff:tiktok')],
            [InlineKeyboardButton('📘 Facebook - Tăng Mắt (15K/1k)', callback_data='buff:facebook')],
            [InlineKeyboardButton('🏠 QUAY LẠI', callback_data='menu:home')]
        ]
        await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))
        
    elif data.startswith("buff:"):
        platform = data.split(":")[1].title()
        user_states[user_id] = {"action": "wait_live_link", "platform": platform}
        await query.edit_message_text(
            f"🔗 Vui lòng gửi link Livestream *{platform}* của bạn vào đây:\n_(Dịch vụ sẽ bắt đầu chạy ngay sau khi trừ tiền)_", 
            parse_mode="Markdown", reply_markup=get_back_button()
        )

    # ============ MUA OTP / PROXY ============
    elif data == "menu:otp":
        text = "⚙️ *THUÊ SỐ NHẬN OTP & PROXY*\n━━━━━━━━━━━━━━━━━━━━\nLựa chọn dịch vụ:"
        kb = [
            [InlineKeyboardButton('📱 Thuê sim nhận OTP (2K/Code)', callback_data='otp:buy')],
            [InlineKeyboardButton('🌐 Mua Proxy IPv4 (10K/Ngày)', callback_data='proxy:buy')],
            [InlineKeyboardButton('🏠 QUAY LẠI', callback_data='menu:home')]
        ]
        await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))
        
    elif data == "otp:buy":
        if user_data['balance'] < 2000:
            await query.edit_message_text("❌ Bạn không đủ 2,000 VNĐ để thuê OTP. Vui lòng nạp thêm.", reply_markup=get_back_button())
            return
        await update_balance(user_id, -2000)
        await log_transaction(user_id, -2000, "BUY_OTP", "OTP_SERVICE")
        text = "✅ *ĐÃ THUÊ SỐ THÀNH CÔNG*\n\n📱 Số điện thoại: `+84 987654321`\n⏳ Đang chờ tin nhắn đến (Tối đa 3 phút)..."
        await query.edit_message_text(text, parse_mode="Markdown", reply_markup=get_back_button())

    # ============ VIP CENTER ============
    elif data == "menu:vip":
        total_dep = user_data.get('total_deposited', 0)
        text = (
            "👑 *TRUNG TÂM VIP*\n━━━━━━━━━━━━━━━━━━━━\n"
            f"Cấp độ hiện tại của bạn: *VIP {user_data['vip_level']}*\n"
            f"Tổng tiền đã nạp: *{format_money(total_dep)}*\n\n"
            "📊 *ĐIỀU KIỆN LÊN CẤP:*\n"
            "• VIP 1: Tích luỹ nạp 500K (Giảm 5% dịch vụ)\n"
            "• VIP 2: Tích luỹ nạp 2 Triệu (Giảm 10% dịch vụ)\n"
            "• VIP 3: Tích luỹ nạp 5 Triệu (Giảm 20% dịch vụ)\n"
        )
        await query.edit_message_text(text, parse_mode="Markdown", reply_markup=get_back_button())

    # ============ TÍNH NĂNG GIỚI THIỆU (REF) ============
    elif data == "menu:ref":
        ref_count = await get_ref_stats(user_id)
        ref_link = f"https://t.me/{BOT_USERNAME}?start=ref_{user_id}"
        text = (
            "🎊 *CHƯƠNG TRÌNH GIỚI THIỆU (AFFILIATE)*\n━━━━━━━━━━━━━━━━━━━━\n"
            "Mời bạn bè sử dụng bot để nhận 10% hoa hồng mỗi khi họ nạp tiền!\n\n"
            f"👥 Số người bạn đã mời: *{ref_count} người*\n"
            f"🔗 Link giới thiệu của bạn:\n`{ref_link}`"
        )
        await query.edit_message_text(text, parse_mode="Markdown", reply_markup=get_back_button())
        
    # ============ APP TOOL / CODE ============
    elif data in ["menu:tools", "menu:live"]:
        text = "🧰 *CỬA HÀNG TOOL & CODE*\n\nTính năng đang trong quá trình cập nhật sản phẩm. Vui lòng quay lại sau!"
        await query.edit_message_text(text, parse_mode="Markdown", reply_markup=get_back_button())

    # ============ TRUNG TÂM KHÁCH HÀNG ============
    elif data == "menu:customer":
        text = "💎 *QUẢN LÝ TÀI KHOẢN*\nBạn có thể quản lý các tài khoản đã mua, lịch sử giao dịch tại đây."
        kb = [
            [InlineKeyboardButton('📜 Lịch sử giao dịch', callback_data='customer:history')],
            [InlineKeyboardButton('🏠 QUAY LẠI', callback_data='menu:home')]
        ]
        await query.edit_message_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(kb))

    # ============ HỖ TRỢ ============
    elif data == "menu:support":
        user_states[user_id] = {"action": "wait_support_msg"}
        await query.edit_message_text("🧑‍💻 Vui lòng gõ nội dung bạn cần hỗ trợ và gửi vào đây. Admin sẽ check và trả lời bạn sớm nhất.", reply_markup=get_back_button())

# ============ XỬ LÝ NHẬP VĂN BẢN (TEXT) ============
async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    text = update.message.text.strip()
    
    if user_id not in user_states: return
    state = user_states[user_id]
    
    if state["action"] == "deposit_custom":
        if not text.isdigit() or int(text) < 10000:
            await update.message.reply_text("❌ Số tiền không hợp lệ. Vui lòng nhập số lớn hơn 10,000.", reply_markup=get_back_button())
            return
        amount = int(text)
        ref_code = f"NAP {user_id}"
        qr_url = f"https://img.vietqr.io/image/VCB-1234567899-compact2.png?amount={amount}&addInfo={ref_code}&accountName=NGUYEN VAN A"
        del user_states[user_id]
        cap = f"🏦 *NẠP TIỀN*\nNội dung CK: `{ref_code}`\nSố tiền: `{format_money(amount)}`"
        await update.message.reply_photo(photo=qr_url, caption=cap, parse_mode="Markdown", reply_markup=get_back_button())

    elif state["action"] == "wait_live_link":
        platform = state["platform"]
        price = 10000 if platform == "Tiktok" else 15000
        user_data = await get_user(user_id)
        
        if user_data['vip_level'] == 1: price = int(price * 0.95)
        elif user_data['vip_level'] == 2: price = int(price * 0.90)
        elif user_data['vip_level'] == 3: price = int(price * 0.80)
        
        if user_data['balance'] < price:
            await update.message.reply_text(f"❌ Số dư không đủ ({format_money(price)}). Vui lòng nạp thêm tiền.", reply_markup=get_back_button())
        else:
            await update_balance(user_id, -price)
            await log_transaction(user_id, -price, "BUY_SERVICE", f"BUFF_{platform.upper()}")
            await update.message.reply_text(f"✅ *THÀNH CÔNG!*\nĐã bắt đầu tăng mắt cho link: {text}\nTrừ tiền: `-{format_money(price)}`", parse_mode="Markdown", reply_markup=get_back_button())
        del user_states[user_id]

    elif state["action"] == "wait_support_msg":
        if ADMIN_ID != "YOUR_ADMIN_ID_HERE":
            await context.bot.send_message(chat_id=ADMIN_ID, text=f"🧑‍💻 *Yêu cầu CSKH mới*\nTừ ID: `{user_id}`\nNội dung: {text}", parse_mode="Markdown")
        await update.message.reply_text("✅ Đã gửi tin nhắn đến Admin thành công! Vui lòng chờ phản hồi.", reply_markup=get_back_button())
        del user_states[user_id]

# ================= ADMIN COMMANDS =================
async def cmd_addmoney(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if str(update.effective_user.id) != ADMIN_ID: return
    try:
        target_id = context.args[0]
        amount = float(context.args[1])
        await update_balance(target_id, amount, is_deposit=True) 
        await update.message.reply_text(f"✅ Đã cộng {format_money(amount)} cho ID {target_id}")
        await context.bot.send_message(chat_id=target_id, text=f"🎉 Admin vừa cộng vào tài khoản của bạn: `{format_money(amount)}`", parse_mode="Markdown")
    except Exception:
        await update.message.reply_text("Cú pháp: /addmoney <ID> <Số tiền>")

# ================= CẤU HÌNH BOT =================
bot_app = ApplicationBuilder().token(BOT_TOKEN).build()
bot_app.add_handler(CommandHandler("start", cmd_start))
bot_app.add_handler(CommandHandler("menu", cmd_start))
bot_app.add_handler(CommandHandler("addmoney", cmd_addmoney))
bot_app.add_handler(CallbackQueryHandler(callback_router))
bot_app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

# ================= FASTAPI & LIFESPAN (CHUẨN MỚI) =================
@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool
    # 1. Kết nối PostgreSQL
    db_pool = await asyncpg.create_pool(DATABASE_URL)
    await init_db()
    print("✅ Database PostgreSQL Connected!")
    
    # 2. Khởi chạy Bot
    await bot_app.initialize()
    await bot_app.start()
    await bot_app.updater.start_polling()
    print("🤖 Bot Telegram đã khởi động!")
    
    yield # Server FastAPI đang chạy
    
    # 3. Tắt an toàn
    print("🛑 Đang tắt bot và đóng Database...")
    await bot_app.updater.stop()
    await bot_app.stop()
    await bot_app.shutdown()
    await db_pool.close()

app = FastAPI(lifespan=lifespan)

# Webhook xử lý nạp tiền tự động từ Ngân Hàng
class BankTransaction(BaseModel):
    amountIn: float
    content: str
    referenceCode: str

@app.post("/webhook/bank")
async def bank_webhook(transaction: BankTransaction):
    content = transaction.content.upper()
    amount = transaction.amountIn
    if "NAP" in content:
        parts = content.split()
        for part in parts:
            if part.isdigit():
                user_id = part
                await log_transaction(user_id, amount, "DEPOSIT", transaction.referenceCode)
                await update_balance(user_id, amount, is_deposit=True) 
                
                new_data = await get_user(user_id)
                msg = (
                    f"🎉 **NẠP TIỀN THÀNH CÔNG!**\n\n"
                    f"• Nhận: `+{format_money(amount)}`\n"
                    f"• Mã GD: `{transaction.referenceCode}`\n"
                    f"• Số dư mới: `{format_money(new_data['balance'])}`"
                )
                await bot_app.bot.send_message(chat_id=user_id, text=msg, parse_mode="Markdown")
                break
    return {"status": "success"}

# ================= CHẠY SERVER DÀNH CHO RENDER =================
if __name__ == "__main__":
    # Render sẽ cấp Port qua biến môi trường $PORT. Nếu chạy Local, mặc định là 8000
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
