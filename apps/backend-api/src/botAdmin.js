const { updateBalance, logTransaction } = require('./database');

const ADMIN_ID = String(process.env.ADMIN_ID || '');

function setupBotAdmin(bot) {
  bot.command('addmoney', async (ctx) => {
    const senderId = String(ctx.from.id);
    if (senderId !== ADMIN_ID) {
      await ctx.reply('Bạn không có quyền sử dụng lệnh này.');
      return;
    }

    const args = ctx.message.text.trim().split(/\s+/);
    if (args.length !== 3) {
      await ctx.reply('Cú pháp: /addmoney <TELEGRAM_USER_ID> <SỐ_TIỀN>');
      return;
    }

    const targetId = args[1];
    const amount = Number(args[2]);

    if (!/^\d{5,20}$/.test(targetId) || !Number.isSafeInteger(amount) || amount <= 0) {
      await ctx.reply('ID người dùng hoặc số tiền không hợp lệ.');
      return;
    }

    try {
      await updateBalance(targetId, amount, false);
      await logTransaction(targetId, amount, 'ADMIN_CREDIT', null, 'paid');

      const formatted = new Intl.NumberFormat('vi-VN').format(amount);
      await ctx.reply(`Đã cộng ${formatted} VNĐ cho tài khoản ${targetId}.`);

      try {
        await bot.telegram.sendMessage(
          targetId,
          `Quản trị viên đã cộng ${formatted} VNĐ vào số dư tài khoản của bạn.`
        );
      } catch (notifyError) {
        console.error('Không thể gửi thông báo cộng tiền:', notifyError.message);
      }
    } catch (error) {
      console.error('Lệnh /addmoney thất bại:', error.message);
      await ctx.reply('Không thể cập nhật số dư. Vui lòng kiểm tra log máy chủ.');
    }
  });
}

module.exports = { setupBotAdmin };
