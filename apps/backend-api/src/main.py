import os
import httpx
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn

from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, CallbackQueryHandler, MessageHandler, filters
from database import Database, init_db, log_transaction, update_balance, get_user
from bot_client import cmd_start, callback_router, text_handler
from bot_admin import cmd_addmoney

BOT_TOKEN = os.getenv("BOT_TOKEN", "YOUR_BOT_TOKEN_HERE")
FRONTEND_DIST = "../../admin-dashboard/dist" 

# Biến môi trường RENDER_EXTERNAL_URL do Render tự cấp (VD: https://my-bot.onrender.com)
RENDER_URL = os.getenv("RENDER_EXTERNAL_URL", "")

bot_app = ApplicationBuilder().token(BOT_TOKEN).build()

# Đăng ký Handlers
bot_app.add_handler(CommandHandler("start", cmd_start))
bot_app.add_handler(CommandHandler("menu", cmd_start))
bot_app.add_handler(CommandHandler("addmoney", cmd_addmoney))
bot_app.add_handler(CallbackQueryHandler(callback_router))
bot_app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

# ================= QUẢN LÝ WEBSOCKET SERVER =================
class WebSocketManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)

ws_manager = WebSocketManager()

# ================= LIFESPAN & AUTO WEBHOOK =================
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Bật Database
    await Database.connect()
    await init_db()
    print("✅ Đã kết nối PostgreSQL")
    
    # 2. Khởi tạo Bot App (Không dùng Polling)
    await bot_app.initialize()
    
    # 3. Tự động Set Webhook lên Telegram bằng URL của Render
    if RENDER_URL:
        webhook_url = f"{RENDER_URL}/webhook/telegram"
        async with httpx.AsyncClient() as client:
            res = await client.get(f"https://api.telegram.org/bot{BOT_TOKEN}/setWebhook?url={webhook_url}")
            if res.json().get("ok"):
                print(f"✅ Webhook đã thiết lập thành công: {webhook_url}")
            else:
                print(f"❌ Lỗi thiết lập Webhook: {res.text}")
    else:
        print("⚠️ Không tìm thấy biến RENDER_EXTERNAL_URL. Chạy ở chế độ local.")

    yield # Server đang chạy
    
    # 4. Tắt an toàn
    await bot_app.shutdown()
    await Database.close()

app = FastAPI(lifespan=lifespan)

# ================= API ENDPOINTS =================

# 1. Nhận cập nhật từ Telegram qua Webhook
@app.post("/webhook/telegram")
async def telegram_webhook(request: Request):
    try:
        update_dict = await request.json()
        update = Update.de_json(update_dict, bot_app.bot)
        # Bắn dữ liệu vào bot xử lý bất đồng bộ
        await bot_app.process_update(update)
    except Exception as e:
        print(f"Lỗi Webhook: {e}")
    return {"status": "ok"}

# 2. WebSocket Endpoint (Dùng để đồng bộ mã nguồn, ghép đối đầu, v.v)
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Ví dụ: Client gửi code, Server broadcast cập nhật
            await ws_manager.broadcast(f"🔄 Đồng bộ từ Server: {data}")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)

# 3. Webhook Ngân Hàng Nạp Tiền
class BankTransaction(BaseModel):
    amountIn: float
    referenceCode: str
    content: str

@app.post("/webhook/bank")
async def bank_webhook(transaction: BankTransaction):
    # Logic nạp tiền như cũ
    return {"status": "success"}

# 4. Serve Frontend
if os.path.exists(FRONTEND_DIST):
    if os.path.exists(f"{FRONTEND_DIST}/assets"):
        app.mount("/assets", StaticFiles(directory=f"{FRONTEND_DIST}/assets"), name="assets")
    @app.get("/")
    async def serve_frontend():
        return FileResponse(f"{FRONTEND_DIST}/index.html")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
