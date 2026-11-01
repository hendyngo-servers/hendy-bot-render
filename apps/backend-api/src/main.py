import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn

from telegram.ext import ApplicationBuilder, CommandHandler, CallbackQueryHandler, MessageHandler, filters
from database import Database, init_db, log_transaction, update_balance, get_user
from bot_client import cmd_start, callback_router, text_handler
from bot_admin import cmd_addmoney

BOT_TOKEN = os.getenv("BOT_TOKEN", "YOUR_BOT_TOKEN_HERE")
FRONTEND_DIST = "../../admin-dashboard/dist" # Đường dẫn tới code build frontend

bot_app = ApplicationBuilder().token(BOT_TOKEN).build()

# Gắn các handler từ bot_client và bot_admin
bot_app.add_handler(CommandHandler("start", cmd_start))
bot_app.add_handler(CommandHandler("menu", cmd_start))
bot_app.add_handler(CommandHandler("addmoney", cmd_addmoney))
bot_app.add_handler(CallbackQueryHandler(callback_router))
bot_app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Bật Database
    await Database.connect()
    await init_db()
    print("✅ Đã kết nối PostgreSQL (Neon.tech)")
    
    # 2. Bật Bot Telegram
    await bot_app.initialize()
    await bot_app.start()
    await bot_app.updater.start_polling()
    print("🤖 Bot Telegram đã khởi động thành công!")
    
    yield
    
    # 3. Tắt ứng dụng an toàn
    print("🛑 Đang tắt hệ thống...")
    await bot_app.updater.stop()
    await bot_app.stop()
    await bot_app.shutdown()
    await Database.close()

app = FastAPI(lifespan=lifespan)

# === PHỤC VỤ FRONTEND DASHBOARD ===
if os.path.exists(FRONTEND_DIST):
    if os.path.exists(f"{FRONTEND_DIST}/assets"):
        app.mount("/assets", StaticFiles(directory=f"{FRONTEND_DIST}/assets"), name="assets")

    @app.get("/")
    async def serve_frontend():
        return FileResponse(f"{FRONTEND_DIST}/index.html")
else:
    @app.get("/")
    async def serve_frontend_fallback():
        return {"message": "Admin Dashboard chưa được build. Vui lòng chạy 'npm run build'."}

# === API WEBHOOK NHẬN TIỀN NGÂN HÀNG ===
class BankTransaction(BaseModel):
    amountIn: float
    content: str
    referenceCode: str

def format_money(amount):
    return f"{int(amount):,} VNĐ".replace(",", ".")

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

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
