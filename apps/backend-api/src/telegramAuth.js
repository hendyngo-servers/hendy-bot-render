const crypto = require('crypto');

function safeCompare(left,right) {
  const a=Buffer.from(String(left||''),'utf8');
  const b=Buffer.from(String(right||''),'utf8');
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
function validateTelegramInitData(initData,botToken) {
  if(!initData || typeof initData!=='string' || initData.length>8192) throw new Error('Thiếu dữ liệu xác thực Telegram.');
  if(!botToken) throw new Error('Bot token chưa được cấu hình.');
  const params=new URLSearchParams(initData);
  const hash=params.get('hash');
  if(!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Chữ ký Telegram không hợp lệ.');
  const authDate=Number(params.get('auth_date'));
  const now=Math.floor(Date.now()/1000);
  const maxAge=Math.max(60,Number(process.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS||86400));
  if(!Number.isFinite(authDate)||authDate>now+60||now-authDate>maxAge) throw new Error('Phiên Telegram đã hết hạn.');
  const checkString=Array.from(params.entries()).filter(([key])=>key!=='hash')
    .sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>key+'='+value).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(botToken).digest();
  const calculated=crypto.createHmac('sha256',secret).update(checkString).digest('hex');
  if(!safeCompare(calculated,hash.toLowerCase())) throw new Error('Không thể xác minh chữ ký Telegram.');
  let user;
  try { user=JSON.parse(params.get('user')||'{}'); }
  catch { throw new Error('Dữ liệu Telegram không hợp lệ.'); }
  if(!user || !/^\d{5,20}$/.test(String(user.id||''))) throw new Error('Không tìm thấy Telegram user ID hợp lệ.');
  return user;
}
function tokenForBot(botKey) {
  return botKey==='secondary'?(process.env.BOT_SECOND_TOKEN||''):(process.env.BOT_TOKEN||'');
}
function adminForBot(botKey) {
  return botKey==='secondary'?String(process.env.BOT_SECOND_ADMIN_ID||process.env.ADMIN_ID||''):String(process.env.ADMIN_ID||'');
}
function authenticateTelegram(req,res,next) {
  try {
    const botKey=req.get('x-telegram-bot-key')==='secondary'?'secondary':'primary';
    const authorization=req.get('authorization')||'';
    const initData=authorization.startsWith('tma ')?authorization.slice(4):(req.get('x-telegram-init-data')||'');
    const token=tokenForBot(botKey);
    if(!token) return res.status(404).json({error:'Bot được yêu cầu chưa được cấu hình.'});
    req.botKey=botKey;
    req.telegramUser=validateTelegramInitData(initData,token);
    req.isAdmin=String(req.telegramUser.id)===adminForBot(botKey);
    next();
  } catch(error) {
    res.status(401).json({error:error.message||'Yêu cầu xác thực Telegram.'});
  }
}
function requireAdmin(req,res,next) {
  if(!req.isAdmin) return res.status(403).json({error:'Bạn không có quyền quản trị.'});
  next();
}
module.exports={validateTelegramInitData,authenticateTelegram,requireAdmin,tokenForBot,adminForBot};
