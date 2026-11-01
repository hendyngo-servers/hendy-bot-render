const { updateBalance } = require('./database');

const ADMIN_ID = process.env.ADMIN_ID || "9144036314:AAG1hV_3SbF-efUV1qGCQKPg9EpwYdUXsi0";

function setupBotAdmin(bot) {
    bot.command('addmoney', async (ctx) => {
        const userId = String(ctx.from.id);
        if (userId !== ADMIN_ID) return;

        const args = ctx.message.text.split(' ');
        if (args.length < 3) {
            return ctx.reply("❌ Cú pháp: /addmoney <ID> <Số_tiền>");
        }

        const targetId = args[1];
        const amount = parseFloat(args[2]);

        try {
            await updateBalance(targetId, amount, true);
            const formatted = new Intl.NumberFormat('vi-VN').format(amount) + " VNĐ";
            
            await ctx.reply(`✅ Đã cộng ${formatted} cho ID ${targetId}`);
            await bot.telegram.sendMessage(targetId, `🎉 Admin đã cộng vào tài khoản của bạn: *${formatted}*`, { parse_mode: "Markdown" });
        } catch (error) {
            await ctx.reply(`❌ Lỗi: ${error.message}`);
        }
    });
}

module.exports = { setupBotAdmin };
