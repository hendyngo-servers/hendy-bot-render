const { Markup } = require('telegraf');
const { getUser, updateBalance, logTransaction } = require('./database');

const ADMIN_ID = process.env.ADMIN_ID || "YOUR_ADMIN_ID_HERE";
const WEBAPP_URL = process.env.WEBAPP_URL || "https://your-mini-app.pages.dev";
const GROUP_URL = process.env.GROUP_URL || "https://t.me/your_group";
const CHANNEL_URL = process.env.CHANNEL_URL || "https://t.me/your_channel";

// Lưu trạng thái nhập liệu tạm thời
const userStates = new Map();

function formatMoney(amount) {
    return new Intl.NumberFormat('vi-VN').format(amount) + " VNĐ";
}

// Bố cục Menu Y Hệt Hình Bạn Gửi
function getHomeKeyboard(userId) {
    let buttons = [
        [Markup.button.callback('🚀 MINIGAME LIVE', 'menu:minigame'), Markup.button.callback('🤖 THUÊ TOOL (NEW)', 'menu:tools')],
        [Markup.button.callback('🛍 MƯA LÌ XÌ - CODE MÀN - CODE TELE', 'menu:lixi')],
        [Markup.button.callback('💳 NẠP TIỀN', 'menu:wallet'), Markup.button.callback('🎁 OTP & PROXY', 'menu:otp')],
        [Markup.button.callback('👑 KHO CÔNG CỤ ĐẶC QUYỀN', 'menu:vip_tools')],
        [Markup.button.callback('💎 TRUNG TÂM KHÁCH HÀNG', 'menu:customer')],
        [Markup.button.callback('🤼 HỆ THỐNG GHÉP ĐỐI ĐẦU', 'menu:matchmaking')],
        [Markup.button.callback('👥 Giới thiệu REF', 'menu:ref'), Markup.button.callback('👑 TRUNG TÂM VIP', 'menu:vip')],
        [Markup.button.url('💬 NHÓM CHAT', GROUP_URL), Markup.button.url('📢 KÊNH THÔNG BÁO', CHANNEL_URL)],
        [Markup.button.callback('🎁 NHẬP GIFCODE', 'menu:giftcode'), Markup.button.callback('🎧 LIÊN HỆ CSKH', 'menu:support')]
    ];
    if (userId === ADMIN_ID) {
        buttons.push([Markup.button.webApp('🛡️ BẢNG ĐIỀU KHIỂN ADMIN', WEBAPP_URL)]);
    }
    return Markup.inlineKeyboard(buttons);
}

function getBackButton() {
    return Markup.inlineKeyboard([[Markup.button.callback('🏠 QUAY LẠI MENU', 'menu:home')]]);
}

async function sendWelcome(ctx, userId, userData, name) {
    const text = `🤖 *HENDY CYBERTECH PRO 2026*\nXin chào sếp, *${name}*!\n🆔 ID: \`${userId}\`\n━━━━━━━━━━━━━━━━━━━━\n💰 Số dư: *${formatMoney(userData.balance)}*\n👑 Cấp độ: *VIP ${userData.vip_level}*\n━━━━━━━━━━━━━━━━━━━━\n👉 Lựa chọn tính năng bên dưới:`;
    
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...getHomeKeyboard(userId) });
    } else {
        await ctx.reply(text, { parse_mode: 'Markdown', ...getHomeKeyboard(userId) });
    }
}

function setupBotClient(bot) {
    bot.start(async (ctx) => {
        const userId = String(ctx.from.id);
        const refBy = ctx.startPayload ? ctx.startPayload.replace('ref_', '') : null;
        const validRef = (refBy && refBy !== userId) ? refBy : null;
        
        const userData = await getUser(userId, ctx.from.first_name, ctx.from.username, validRef);
        userStates.delete(userId);
        await sendWelcome(ctx, userId, userData, ctx.from.first_name);
    });

    bot.on('callback_query', async (ctx) => {
        const data = ctx.callbackQuery.data;
        const userId = String(ctx.from.id);
        const userData = await getUser(userId);

        if (data === 'menu:home') {
            userStates.delete(userId);
            await sendWelcome(ctx, userId, userData, ctx.from.first_name);
        }
        else if (data === 'menu:wallet') {
            const text = `💳 *NẠP TIỀN TỰ ĐỘNG*\n💰 Số dư: *${formatMoney(userData.balance)}*\nChọn mệnh giá:`;
            const kb = Markup.inlineKeyboard([
                [Markup.button.callback('50K', 'deposit:50000'), Markup.button.callback('100K', 'deposit:100000')],
                [Markup.button.callback('✍️ NHẬP SỐ KHÁC', 'deposit:custom')],
                [Markup.button.callback('🏠 QUAY LẠI', 'menu:home')]
            ]);
            await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
        }
        else if (data.startsWith('deposit:')) {
            const val = data.split(':')[1];
            if (val === 'custom') {
                userStates.set(userId, { action: 'deposit_custom' });
                await ctx.editMessageText("✍️ Vui lòng nhập số tiền bạn muốn nạp (Ví dụ: 150000):", getBackButton());
            } else {
                const amount = parseInt(val);
                const refCode = `NAP ${userId}`;
                const qrUrl = `https://img.vietqr.io/image/VCB-1234567899-compact2.png?amount=${amount}&addInfo=${refCode}&accountName=HENDY`;
                await ctx.deleteMessage();
                await ctx.replyWithPhoto({ url: qrUrl }, { caption: `🏦 *NẠP TIỀN*\n• Số tiền: \`${formatMoney(amount)}\`\n• Nội dung: \`${refCode}\``, parse_mode: 'Markdown', ...getBackButton() });
            }
        }
        else if (data === 'menu:giftcode') {
            userStates.set(userId, { action: 'wait_giftcode' });
            await ctx.editMessageText("🎁 Vui lòng nhập mã GIFCODE của bạn vào đây:", getBackButton());
        }
        else if (data === 'menu:support') {
            userStates.set(userId, { action: 'wait_support_msg' });
            await ctx.editMessageText("🎧 Gõ nội dung bạn cần hỗ trợ, Admin sẽ phản hồi sớm nhất:", getBackButton());
        }
        else {
            const featureName = {
                "menu:minigame": "🚀 Minigame Live", "menu:tools": "🤖 Thuê Tool", "menu:lixi": "🛍 Mưa Lì Xì",
                "menu:otp": "🎁 OTP & Proxy", "menu:vip_tools": "👑 Kho Công Cụ VIP", "menu:customer": "💎 Trung Tâm KH",
                "menu:matchmaking": "🤼 Hệ Thống Đối Đầu", "menu:ref": "👥 Giới thiệu", "menu:vip": "👑 VIP"
            };
            if (featureName[data]) {
                await ctx.editMessageText(`🚧 Tính năng *${featureName[data]}* đang được cập nhật, vui lòng quay lại sau!`, { parse_mode: 'Markdown', ...getBackButton() });
            }
        }
        await ctx.answerCbQuery();
    });

    bot.on('text', async (ctx, next) => {
        const userId = String(ctx.from.id);
        if (!userStates.has(userId)) return next();
        
        const state = userStates.get(userId);
        const text = ctx.message.text.trim();

        if (state.action === 'deposit_custom') {
            if (isNaN(text) || parseInt(text) < 10000) {
                return ctx.reply("❌ Số tiền không hợp lệ (Phải là số và >= 10,000).", getBackButton());
            }
            const amount = parseInt(text);
            const refCode = `NAP ${userId}`;
            const qrUrl = `https://img.vietqr.io/image/VCB-1234567899-compact2.png?amount=${amount}&addInfo=${refCode}&accountName=HENDY`;
            userStates.delete(userId);
            await ctx.replyWithPhoto({ url: qrUrl }, { caption: `🏦 *NẠP TIỀN*\nNội dung: \`${refCode}\`\nSố tiền: \`${formatMoney(amount)}\``, parse_mode: 'Markdown', ...getBackButton() });
        }
        else if (state.action === 'wait_giftcode') {
            await ctx.reply("❌ Mã Giftcode không hợp lệ hoặc đã hết hạn.", getBackButton());
            userStates.delete(userId);
        }
        else if (state.action === 'wait_support_msg') {
            if (ADMIN_ID !== "YOUR_ADMIN_ID_HERE") {
                await bot.telegram.sendMessage(ADMIN_ID, `🎧 *HỖ TRỢ CSKH*\nTừ ID: \`${userId}\`\nNội dung: ${text}`, { parse_mode: "Markdown" });
            }
            await ctx.reply("✅ Đã gửi yêu cầu hỗ trợ đến CSKH!", getBackButton());
            userStates.delete(userId);
        }
    });
}

module.exports = { setupBotClient };
