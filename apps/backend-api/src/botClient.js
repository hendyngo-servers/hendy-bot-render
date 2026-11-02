const crypto = require('crypto');
const { pool, getUser } = require('./database');
const {
  callbackButton,
  urlButton,
  inlineWebAppButton,
  replyButton,
  replyWebAppButton,
  inlineKeyboard,
  replyKeyboard
} = require('./ui/buttonTheme');

const INPUT_TTL_MS = 10 * 60 * 1000;
const ALLOWED_BRANDS = ['QQ88', '78WIN', 'SC88', 'C168', 'CM88', 'F8BET'];

const DEFAULT_MENU_ITEMS = [
  { action:'live', label:'🚀 MINIGAME LIVE', style:'primary', description:'Liên kết và quản lý tài khoản trò chơi.' },
  { action:'tools', label:'🧰 THUÊ TOOL (NEW)', style:'primary', description:'Xem công cụ và thời hạn thuê.' },
  { action:'codes', label:'🎁 MUA LÌ XÌ · CODE MÀN · CODE TELE', style:'success', description:'Mua code và theo dõi đơn hàng.' },
  { action:'wallet', label:'💳 NẠP TIỀN', style:'success', description:'Tạo thông tin VietQR và xem lịch sử nạp.' },
  { action:'otp', label:'⚙️ OTP & PROXY', style:'primary', description:'Xem các gói OTP và Proxy đang mở bán.' },
  { action:'viptools', label:'🏆 VIP KHO CÔNG CỤ ĐẶC QUYỀN', style:'primary', description:'Khám phá kho công cụ dành cho thành viên VIP.' },
  { action:'customer', label:'💎 TRUNG TÂM KHÁCH HÀNG', style:'primary', description:'Xem hồ sơ, số dư, đơn hàng và liên kết.' },
  { action:'duel', label:'⚔️ HỆ THỐNG GHÉP ĐỐI ĐẦU', style:'primary', description:'Vào hàng chờ và ghép với thành viên khác.' },
  { action:'ref', label:'🎊 GIỚI THIỆU REF', style:'success', description:'Chia sẻ link và theo dõi hoa hồng giới thiệu.' },
  { action:'vip', label:'👑 TRUNG TÂM VIP', style:'primary', description:'Xem cấp VIP và gói nâng cấp.' },
  { action:'group', label:'🗣️ NHÓM CHAT', style:'primary', description:'Mở liên kết cộng đồng chính thức.' },
  { action:'news', label:'📢 KÊNH THÔNG BÁO', style:'primary', description:'Theo dõi thông báo và cập nhật mới.' },
  { action:'gift', label:'🎟️ NHẬP GIFTCODE', style:'success', description:'Nhập mã quà tặng vào tài khoản.' },
  { action:'support', label:'🧑‍💻 LIÊN HỆ CSKH', style:'primary', description:'Gửi yêu cầu hỗ trợ tới đội ngũ CSKH.' }
];

const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[char]));
const money = value => Number(value || 0).toLocaleString('vi-VN') + ' VNĐ';
const dateText = value => value ? new Date(value).toLocaleString('vi-VN') : '—';

function getMiniAppUrl(section = 'admin', botKey = 'primary') {
  const configured = String(process.env.MINI_APP_URL || process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL || '').trim();
  if (!/^https:\/\//i.test(configured)) return null;
  try {
    const url = new URL(configured);
    url.searchParams.set('section', section);
    url.searchParams.set('bot', botKey);
    return url.toString();
  } catch {
    return null;
  }
}

async function getBotMenuConfig(botKey) {
  const result = await pool.query(
    'SELECT * FROM bot_menu_configs WHERE bot_key=$1',
    [botKey]
  );
  if (result.rowCount) return result.rows[0];
  return {
    bot_key:botKey,
    menu_mode:'reply_keyboard',
    intro_text:'Chào mừng bạn đến với HENDY BOT. Chọn dịch vụ ở bàn phím phía dưới để bắt đầu.',
    menu_columns:2,
    persistent_keyboard:true,
    resize_keyboard:true,
    button_labels:{},
    button_descriptions:{},
    button_styles:{}
  };
}

function getMenuItems(config, userId, adminId) {
  const labels = config.button_labels || {};
  const descriptions = config.button_descriptions || {};
  const styles = config.button_styles || {};
  const items = DEFAULT_MENU_ITEMS.map(item => ({
    ...item,
    label:String(labels[item.action] || item.label).slice(0, 60),
    description:String(descriptions[item.action] || item.description).slice(0, 160),
    style:['primary','success','danger'].includes(styles[item.action]) ? styles[item.action] : item.style
  }));
  if (adminId && String(userId) === String(adminId)) {
    items.push({
      action:'admin',
      label:String(labels.admin || '🛡️ BẢNG ĐIỀU KHIỂN ADMIN').slice(0,60),
      style:['primary','success','danger'].includes(styles.admin) ? styles.admin : 'primary',
      description:String(descriptions.admin || 'Mở bảng quản trị dành riêng cho Admin.').slice(0,160)
    });
  }
  return items;
}

function chunk(items, size) {
  const rows = [];
  for (let i=0;i<items.length;i+=size) rows.push(items.slice(i,i+size));
  return rows;
}

function buildMenuKeyboard(config, userId, adminId, botKey) {
  const items = getMenuItems(config, userId, adminId);
  const columns = Math.min(3,Math.max(1,Number(config.menu_columns || 2)));
  const rows = chunk(items,columns);

  if (config.menu_mode === 'inline_keyboard') {
    const inlineRows = rows.map(row => row.map(item => {
      if (item.action === 'admin') {
        const url = getMiniAppUrl('admin',botKey);
        return url
          ? inlineWebAppButton(item.label,url,item.style)
          : callbackButton('🛡️ ADMIN · CẤU HÌNH MINI_APP_URL','member:admin-unavailable','danger');
      }
      return callbackButton(item.label,'member:'+item.action,item.style);
    }));
    return inlineKeyboard(inlineRows);
  }

  const replyRows = rows.map(row => row.map(item => {
    if (item.action === 'admin') {
      const url = getMiniAppUrl('admin',botKey);
      return url
        ? replyWebAppButton(item.label,url,item.style)
        : replyButton('🛡️ ADMIN · CẤU HÌNH MINI_APP_URL','danger');
    }
    return replyButton(item.label,item.style);
  }));
  return replyKeyboard(replyRows,{
    resize:config.resize_keyboard !== false,
    persistent:config.persistent_keyboard !== false,
    placeholder:'Chọn chức năng Hendy Bot'
  });
}

function actionForText(text, config, userId, adminId) {
  const item = getMenuItems(config,userId,adminId).find(entry => entry.label === text);
  return item ? item.action : null;
}

async function getSettings(keys) {
  const result = await pool.query(
    'SELECT key,value FROM app_settings WHERE key=ANY($1::text[])',
    [keys]
  );
  return result.rows.reduce((out,row)=>{out[row.key]=row.value;return out;},{});
}

async function getLinkedAccounts(userId) {
  const result = await pool.query(
    'SELECT id,brand,username,created_at FROM linked_accounts WHERE user_id=$1 ORDER BY created_at DESC',
    [String(userId)]
  );
  return result.rows;
}

function formatWelcome(ctx,userId,user,config) {
  const name=[ctx.from.first_name,ctx.from.last_name].filter(Boolean).join(' ')||ctx.from.username||'thành viên';
  const intro=String(config.intro_text || 'Chào mừng bạn đến với HENDY BOT.').trim();
  const descriptions=getMenuItems(config,userId,ctx.state && ctx.state.adminId).map(item=>'• '+item.label+' — '+item.description);
  return [
    '🤖 <b>HENDY BOT | HENDY CYBERTECH</b>',
    'Xin chào <b>'+escapeHtml(name)+'</b>!',
    '🆔 ID Telegram: <code>'+escapeHtml(userId)+'</code>',
    '━━━━━━━━━━━━━━━━━━━━',
    '💰 Ví chính: <b>'+money(user.balance)+'</b>',
    '👑 Cấp thành viên: <b>VIP '+Number(user.vip_level||0)+'</b>',
    '🔗 Tài khoản đã liên kết: <b>'+(ctx.state && ctx.state.linkedCount || 0)+'</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    escapeHtml(intro),
    '',
    '<b>HƯỚNG DẪN CHỨC NĂNG</b>',
    ...descriptions.map(escapeHtml)
  ].join('\n');
}

async function sendHome(ctx,userId,botContext,config) {
  const user=await getUser(
    userId,
    [ctx.from.first_name,ctx.from.last_name].filter(Boolean).join(' '),
    ctx.from.username
  );
  const accounts=await getLinkedAccounts(userId);
  ctx.state = { ...(ctx.state||{}), adminId:botContext.adminId, linkedCount:accounts.length };
  const keyboard=buildMenuKeyboard(config,userId,botContext.adminId,botContext.botKey);
  return ctx.reply(formatWelcome(ctx,userId,user,config),{
    parse_mode:'HTML',
    disable_web_page_preview:true,
    reply_markup:keyboard
  });
}

function makeSubmenu(config,items,botKey,adminId,userId) {
  const columns=Math.min(3,Math.max(1,Number(config.menu_columns||2)));
  const rows=chunk(items,columns);
  if(config.menu_mode==='inline_keyboard') {
    return inlineKeyboard(rows.map(row=>row.map(item=>{
      if(item.url) return urlButton(item.label,item.url,item.style||'primary');
      return callbackButton(item.label,item.data,item.style||'primary');
    })));
  }
  const replyRows=rows.map(row=>row.map(item=>replyButton(item.label,item.style||'primary')));
  const keyboard=replyKeyboard(replyRows,{
    resize:config.resize_keyboard!==false,
    persistent:config.persistent_keyboard!==false,
    placeholder:'Chọn mục hoặc gửi nội dung theo hướng dẫn'
  });
  return keyboard;
}

async function sendScreen(ctx,text,keyboard,config) {
  const options={parse_mode:'HTML',disable_web_page_preview:true,reply_markup:keyboard};
  if(config.menu_mode==='inline_keyboard' && ctx.callbackQuery && ctx.editMessageText) {
    try { return await ctx.editMessageText(text,options); }
    catch(error) {
      if(/message is not modified/i.test(error.message||'')) return null;
    }
  }
  return ctx.reply(text,options);
}

async function sendCatalog(ctx,userId,category,title,config,botContext,pendingInputs) {
  const actual=category==='viptools'?'vip':category;
  const result=await pool.query(
    'SELECT id,name,price,description,stock,duration_days FROM products '+
    'WHERE category=$1 AND is_active=TRUE AND (stock IS NULL OR stock>0) ORDER BY created_at DESC LIMIT 20',
    [actual]
  );
  const orders=await pool.query(
    'SELECT product_name,amount,status FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5',
    [String(userId)]
  );
  const lines=[
    '🛍️ <b>'+escapeHtml(title)+'</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    result.rowCount?'Chọn sản phẩm để tạo đơn hàng:':'Hiện chưa có sản phẩm được Admin đăng bán.',
    '',
    '<b>ĐƠN GẦN ĐÂY</b>',
    ...(orders.rowCount?orders.rows.map(order=>'• '+escapeHtml(order.product_name)+' — '+money(order.amount)+' · '+escapeHtml(order.status)):['Chưa có đơn hàng.'])
  ];
  const productActions=new Map();
  const items=result.rows.map(row=>{
    const label=(row.name+' · '+money(row.price)).slice(0,60);
    productActions.set(label,'order:'+row.id);
    return {label,data:'member:order:'+row.id,style:'success'};
  });
  productActions.set('🏠 MENU CHÍNH','home');
  items.push({label:'🏠 MENU CHÍNH',data:'member:home',style:'primary'});
  const keyboard=makeSubmenu(config,items,botContext.botKey,botContext.adminId,userId);
  if(config.menu_mode!=='inline_keyboard') {
    pendingInputs.set(userId,{type:'action_map',actions:productActions,expiresAt:Date.now()+INPUT_TTL_MS});
  }
  return sendScreen(ctx,lines.join('\n'),keyboard,config);
}

async function createMemberOrder(userId,productId) {
  if(!/^\d{1,18}$/.test(String(productId))) throw new Error('ID sản phẩm không hợp lệ.');
  const client=await pool.connect();
  let order;
  try {
    await client.query('BEGIN');
    const found=await client.query('SELECT * FROM products WHERE id=$1 AND is_active=TRUE FOR UPDATE',[String(productId)]);
    if(!found.rowCount) throw new Error('Sản phẩm không còn được bán.');
    const product=found.rows[0];
    if(product.stock!==null && Number(product.stock)<=0) throw new Error('Sản phẩm đã hết hàng.');
    const member=await client.query('SELECT balance FROM users WHERE user_id=$1 FOR UPDATE',[String(userId)]);
    if(!member.rowCount) throw new Error('Không tìm thấy hồ sơ thành viên.');
    if(Number(member.rows[0].balance)<Number(product.price)) throw new Error('Số dư không đủ. Hãy chọn NẠP TIỀN trước khi mua.');

    const orderCode='HD'+Date.now().toString(36).toUpperCase()+crypto.randomBytes(3).toString('hex').toUpperCase();
    const balance=await client.query('UPDATE users SET balance=balance-$1 WHERE user_id=$2 RETURNING balance',[product.price,String(userId)]);
    const created=await client.query(
      "INSERT INTO orders (order_code,user_id,product_id,product_name,category,amount,status) VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING order_code,product_name,amount,status",
      [orderCode,String(userId),product.id,product.name,product.category,product.price]
    );
    await client.query(
      "INSERT INTO wallet_ledger (reference_code,user_id,amount,transaction_type,description) VALUES ($1,$2,$3,'PURCHASE',$4)",
      ['order:'+orderCode,String(userId),-Number(product.price),'Thanh toán đơn '+orderCode]
    );
    await client.query(
      "INSERT INTO transactions (user_id,amount,type,reference_code,status) VALUES ($1,$2,'PURCHASE',$3,'paid')",
      [String(userId),product.price,orderCode]
    );
    if(product.stock!==null) await client.query('UPDATE products SET stock=stock-1,updated_at=NOW() WHERE id=$1',[product.id]);
    await client.query('COMMIT');
    order={...created.rows[0],balance:Number(balance.rows[0].balance)};
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  return order;
}

async function createGiftcodeRedemption(userId,rawCode) {
  const code=String(rawCode||'').trim().toUpperCase();
  if(!/^[A-Z0-9_-]{4,64}$/.test(code)) throw new Error('Mã giftcode không đúng định dạng.');
  const client=await pool.connect();
  let reward=0;
  try {
    await client.query('BEGIN');
    const found=await client.query('SELECT * FROM giftcodes WHERE code=$1 FOR UPDATE',[code]);
    if(!found.rowCount) throw new Error('Giftcode không tồn tại.');
    const gift=found.rows[0];
    if(!gift.is_active || (gift.expires_at && new Date(gift.expires_at)<new Date())) throw new Error('Giftcode đã hết hạn hoặc bị khóa.');
    if(Number(gift.redeemed_count)>=Number(gift.max_redemptions)) throw new Error('Giftcode đã hết lượt.');
    const inserted=await client.query(
      'INSERT INTO giftcode_redemptions (code,user_id,reward_amount) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING code',
      [code,String(userId),gift.reward_amount]
    );
    if(!inserted.rowCount) throw new Error('Bạn đã sử dụng giftcode này rồi.');
    reward=Number(gift.reward_amount);
    if(reward>0) {
      await client.query('UPDATE users SET balance=balance+$1 WHERE user_id=$2',[reward,String(userId)]);
      await client.query(
        "INSERT INTO wallet_ledger (reference_code,user_id,amount,transaction_type,description) VALUES ($1,$2,$3,'GIFTCODE',$4)",
        ['giftcode:'+code+':'+userId,String(userId),reward,'Nhận thưởng giftcode '+code]
      );
      await client.query(
        "INSERT INTO transactions (user_id,amount,type,reference_code,status) VALUES ($1,$2,'GIFTCODE',$3,'paid')",
        [String(userId),reward,code]
      );
    }
    await client.query('UPDATE giftcodes SET redeemed_count=redeemed_count+1 WHERE code=$1',[code]);
    await client.query('COMMIT');
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  return reward;
}

async function showDeposit(ctx,userId,amount,config) {
  if(!Number.isSafeInteger(amount)||amount<10000||amount>500000000) throw new Error('Số tiền nạp phải từ 10.000 đến 500.000.000 VNĐ.');
  const settings=await getSettings(['VIETQR_BANK_ID','VIETQR_ACCOUNT_NO','VIETQR_ACCOUNT_NAME']);
  const bank=settings.VIETQR_BANK_ID||process.env.VIETQR_BANK_ID||'';
  const account=settings.VIETQR_ACCOUNT_NO||process.env.VIETQR_ACCOUNT_NO||'';
  const holder=settings.VIETQR_ACCOUNT_NAME||process.env.VIETQR_ACCOUNT_NAME||'';
  if(!bank||!account||!holder) throw new Error('Admin chưa cấu hình tài khoản VietQR.');
  const imagePath=[encodeURIComponent(bank),encodeURIComponent(account),'compact2.png'].join('-');
  const params=new URLSearchParams({amount:String(amount),addInfo:'NAP '+userId,accountName:holder});
  const qrUrl='https://img.vietqr.io/image/'+imagePath+'?'+params.toString();
  const caption=[
    '💳 <b>THÔNG TIN NẠP TIỀN</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    'Số tiền: <b>'+money(amount)+'</b>',
    'Ngân hàng: <b>'+escapeHtml(bank)+'</b>',
    'Số tài khoản: <code>'+escapeHtml(account)+'</code>',
    'Chủ tài khoản: <b>'+escapeHtml(holder)+'</b>',
    'Nội dung chuyển khoản: <code>NAP '+escapeHtml(userId)+'</code>',
    '━━━━━━━━━━━━━━━━━━━━',
    'Trạng thái: <b>Chờ đối soát</b>',
    'Ví được cộng khi webhook ngân hàng hợp lệ xác nhận giao dịch.'
  ].join('\n');
  const keyboard=inlineKeyboard([
    [callbackButton('🔄 KIỂM TRA LỊCH SỬ NẠP','member:deposit-history','primary')],
    [callbackButton('🏠 MENU CHÍNH','member:home','primary')]
  ]);
  try { return await ctx.replyWithPhoto(qrUrl,{caption,parse_mode:'HTML',reply_markup:keyboard}); }
  catch { return ctx.reply(caption+'\n\nKhông tải được ảnh QR. Vui lòng dùng thông tin chuyển khoản ở trên.',{parse_mode:'HTML',reply_markup:keyboard}); }
}

async function showDepositHistory(ctx,userId) {
  const result=await pool.query("SELECT amount,reference_code,status,created_at FROM transactions WHERE user_id=$1 AND type='DEPOSIT' ORDER BY created_at DESC LIMIT 10",[String(userId)]);
  const lines=['💳 <b>LỊCH SỬ NẠP TIỀN</b>','━━━━━━━━━━━━━━━━━━━━'];
  if(!result.rowCount) lines.push('Chưa ghi nhận giao dịch nạp tiền.');
  for(const row of result.rows) lines.push('• +'+money(row.amount)+' · '+escapeHtml(row.reference_code||'—')+' · '+dateText(row.created_at));
  return ctx.reply(lines.join('\n'),{parse_mode:'HTML'});
}

async function showCustomer(ctx,userId) {
  const user=await getUser(userId);
  const [accounts,orders,tickets]=await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM linked_accounts WHERE user_id=$1',[String(userId)]),
    pool.query('SELECT COUNT(*)::int AS total FROM orders WHERE user_id=$1',[String(userId)]),
    pool.query('SELECT COUNT(*)::int AS total FROM support_tickets WHERE user_id=$1',[String(userId)])
  ]);
  return ctx.reply([
    '💎 <b>TRUNG TÂM KHÁCH HÀNG</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    '🆔 Telegram ID: <code>'+escapeHtml(userId)+'</code>',
    '💰 Số dư: <b>'+money(user&&user.balance)+'</b>',
    '👑 Cấp thành viên: <b>VIP '+Number(user&&user.vip_level||0)+'</b>',
    '🔗 Tài khoản liên kết: <b>'+accounts.rows[0].total+'</b>',
    '🧾 Tổng đơn hàng: <b>'+orders.rows[0].total+'</b>',
    '🎧 Yêu cầu CSKH: <b>'+tickets.rows[0].total+'</b>'
  ].join('\n'),{parse_mode:'HTML'});
}

async function showOrders(ctx,userId) {
  const result=await pool.query('SELECT order_code,product_name,amount,status,created_at FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10',[String(userId)]);
  const lines=['🧾 <b>LỊCH SỬ ĐƠN HÀNG</b>','━━━━━━━━━━━━━━━━━━━━'];
  if(!result.rowCount) lines.push('Bạn chưa có đơn hàng.');
  for(const order of result.rows) lines.push('• <b>'+escapeHtml(order.product_name)+'</b> — '+money(order.amount)+'\n  <code>'+escapeHtml(order.order_code)+'</code> · '+escapeHtml(order.status)+' · '+dateText(order.created_at));
  return ctx.reply(lines.join('\n'),{parse_mode:'HTML'});
}

async function createLegacyLoginUrl(userId,botKey) {
  const configured=String(process.env.LEGACY_ACCOUNT_URL||'').trim();
  const sharedSecret=String(process.env.LEGACY_SESSION_SECRET||'');
  if(!/^https:\/\//i.test(configured) || sharedSecret.length<32) return null;

  const ticket=crypto.randomBytes(32).toString('hex');
  const tokenHash=crypto.createHash('sha256').update(ticket).digest('hex');
  await pool.query(
    "INSERT INTO legacy_login_tickets (token_hash,user_id,bot_key,expires_at) VALUES ($1,$2,$3,NOW()+INTERVAL '5 minutes')",
    [tokenHash,String(userId),botKey]
  );
  const url=new URL(configured);
  url.searchParams.set('login_ticket',ticket);
  url.searchParams.set('bot',botKey);
  return url.toString();
}

async function showLive(ctx,userId,config,pendingInputs,botKey) {
  const miniUrl=getMiniAppUrl('customer',botKey);
  const legacyUrl=await createLegacyLoginUrl(userId,botKey);
  const accounts=await getLinkedAccounts(userId);
  const rows=[];
  if(miniUrl) rows.push([inlineWebAppButton('🚀 [MINI APP] BẢN MỚI | CHỈ MOBILE',miniUrl,'success')]);
  else rows.push([callbackButton('🚀 MINI APP CHƯA CẤU HÌNH','member:admin-unavailable','danger')]);
  if(legacyUrl) rows.push([urlButton('🔑 PHIÊN BẢN WEB CŨ · LINK 5 PHÚT',legacyUrl,'primary')]);
  else rows.push([callbackButton('🔑 PHIÊN BẢN WEB CŨ · CHƯA CẤU HÌNH','member:legacy-unavailable','danger')]);
  rows.push([callbackButton('📋 TÀI KHOẢN ĐÃ LIÊN KẾT ('+accounts.length+')','member:live-accounts','primary')]);
  rows.push([callbackButton('🏠 TRỞ VỀ MENU CHÍNH','member:home','primary')]);

  return ctx.reply([
    '🧭 <b>TRUNG TÂM QUẢN LÝ TÀI KHOẢN</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    'Chọn một trong hai cách truy cập bên dưới:',
    '• <b>Mini App:</b> Trải nghiệm mới, mượt mà hơn (khuyến nghị, chỉ hỗ trợ thiết bị có Telegram Web App).',
    '• <b>Đăng nhập truyền thống:</b> Link đăng nhập dùng một lần, có hiệu lực tối đa 5 phút.',
    '',
    'Tài khoản đã liên kết: <b>'+accounts.length+'</b>',
    'Không gửi mật khẩu hoặc mã OTP cho bot.'
  ].join('\n'),{
    parse_mode:'HTML',
    disable_web_page_preview:true,
    reply_markup:inlineKeyboard(rows)
  });
}

async function showLiveAccounts(ctx,userId) {
  const accounts=await getLinkedAccounts(userId);
  const rows=accounts.map(item=>[
    callbackButton('🗑 '+item.brand+' · '+item.username,'member:link-delete:'+item.id,'danger')
  ]);
  rows.push([callbackButton('➕ LIÊN KẾT TÀI KHOẢN','member:link-new','success')]);
  rows.push([callbackButton('⬅️ TRUNG TÂM QUẢN LÝ TÀI KHOẢN','member:live','primary')]);
  rows.push([callbackButton('🏠 MENU CHÍNH','member:home','primary')]);
  return ctx.reply([
    '🔗 <b>TÀI KHOẢN ĐÃ LIÊN KẾT</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    'Số tài khoản: <b>'+accounts.length+'</b>',
    'Thương hiệu hỗ trợ: '+ALLOWED_BRANDS.join(', '),
    'Chỉ lưu tên đăng nhập và thương hiệu; không lưu mật khẩu/OTP.'
  ].join('\n'),{parse_mode:'HTML',reply_markup:inlineKeyboard(rows)});
}


async function showDuel(ctx,userId,bot,config) {
  const active=await pool.query(
    "SELECT * FROM matchmaking_matches WHERE status='matched' AND (player_one=$1 OR player_two=$1) ORDER BY created_at DESC LIMIT 1",
    [String(userId)]
  );
  if(active.rowCount) {
    const match=active.rows[0];
    const other=match.player_one===String(userId)?match.player_two:match.player_one;
    const user=await pool.query('SELECT name,username FROM users WHERE user_id=$1',[other]);
    const name=user.rows[0]&&(user.rows[0].name||user.rows[0].username)||'Thành viên Hendy';
    const keyboard=inlineKeyboard([
      [callbackButton('✅ KẾT THÚC LƯỢT ĐỐI ĐẦU','member:duel-finish:'+match.id,'success')],
      [callbackButton('🏠 MENU CHÍNH','member:home','primary')]
    ]);
    return ctx.reply('⚔️ Đã ghép đối đầu với <b>'+escapeHtml(name)+'</b>. Mã ghép: <code>#'+match.id+'</code>.',{parse_mode:'HTML',reply_markup:keyboard});
  }

  const client=await pool.connect();
  let match=null;
  let waiting=false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['hendy-matchmaking:quick']);
    const queued=await client.query("SELECT id FROM matchmaking_queue WHERE user_id=$1 AND status='waiting' LIMIT 1 FOR UPDATE",[String(userId)]);
    if(queued.rowCount) waiting=true;
    else {
      const partner=await client.query("SELECT id,user_id FROM matchmaking_queue WHERE status='waiting' AND mode='quick' AND user_id<>$1 ORDER BY created_at ASC LIMIT 1 FOR UPDATE",[String(userId)]);
      if(partner.rowCount) {
        const created=await client.query("INSERT INTO matchmaking_matches (player_one,player_two,mode,status) VALUES ($1,$2,'quick','matched') RETURNING *",[partner.rows[0].user_id,String(userId)]);
        match=created.rows[0];
        await client.query("UPDATE matchmaking_queue SET status='paired',matched_user_id=$1,match_id=$2,updated_at=NOW() WHERE id=$3",[String(userId),match.id,partner.rows[0].id]);
        await client.query("INSERT INTO matchmaking_queue (user_id,mode,status,matched_user_id,match_id) VALUES ($1,'quick','paired',$2,$3)",[String(userId),partner.rows[0].user_id,match.id]);
      } else {
        await client.query("INSERT INTO matchmaking_queue (user_id,mode,status) VALUES ($1,'quick','waiting')",[String(userId)]);
        waiting=true;
      }
    }
    await client.query('COMMIT');
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }

  if(!match) {
    return ctx.reply(waiting?'⚔️ <b>Bạn đã vào hàng chờ ghép đối đầu.</b> Bot sẽ thông báo khi tìm được người chơi.':'Không thể tham gia hàng chờ.',{
      parse_mode:'HTML',
      reply_markup:inlineKeyboard([
        [callbackButton('🔄 KIỂM TRA TRẠNG THÁI','member:duel','primary')],
        [callbackButton('❌ RỜI HÀNG CHỜ','member:duel-leave','danger')],
        [callbackButton('🏠 MENU CHÍNH','member:home','primary')]
      ])
    });
  }

  const opponentId=match.player_one===String(userId)?match.player_two:match.player_one;
  for(const recipient of [String(userId),opponentId]) {
    const otherId=recipient===String(userId)?opponentId:String(userId);
    const other=await pool.query('SELECT name,username FROM users WHERE user_id=$1',[otherId]);
    const name=other.rows[0]&&(other.rows[0].name||other.rows[0].username)||'Thành viên Hendy';
    try { await bot.api.sendMessage(recipient,'⚔️ Đã ghép đối đầu với '+name+' · Mã #'+match.id); } catch {}
  }
  return ctx.reply('✅ Đã ghép đối đầu thành công. Mã ghép: <code>#'+match.id+'</code>.',{parse_mode:'HTML'});
}

async function dispatchAction(ctx,action,context) {
  const {bot,botKey,adminId,pendingInputs,config,userId}=context;
  if(action.startsWith('order:')) {
    const order=await createMemberOrder(userId,action.slice('order:'.length));
    return ctx.reply([
      '✅ <b>ĐÃ TẠO ĐƠN HÀNG</b>',
      'Sản phẩm: <b>'+escapeHtml(order.product_name)+'</b>',
      'Mã đơn: <code>'+escapeHtml(order.order_code)+'</code>',
      'Số tiền: '+money(order.amount),
      'Trạng thái: Chờ Admin xử lý.',
      'Số dư còn lại: '+money(order.balance)
    ].join('\\n'),{parse_mode:'HTML',reply_markup:inlineKeyboard([
      [callbackButton('🧾 LỊCH SỬ ĐƠN HÀNG','member:orders','primary')],
      [callbackButton('🏠 MENU CHÍNH','member:home','primary')]
    ])});
  }
  if(action==='home') {
    pendingInputs.delete(userId);
    return sendHome(ctx,userId,{botKey,adminId},config);
  }
  if(action==='admin') {
    if(String(userId)!==String(adminId)) throw new Error('Bạn không có quyền quản trị.');
    const url=getMiniAppUrl('admin',botKey);
    if(!url) throw new Error('Chưa cấu hình MINI_APP_URL.');
    return ctx.reply('🛡️ <b>BẢNG ĐIỀU KHIỂN ADMIN</b>\nMở giao diện quản trị an toàn trong Telegram Mini App.',{
      parse_mode:'HTML',
      reply_markup:inlineKeyboard([[inlineWebAppButton('🛡️ MỞ BẢNG ĐIỀU KHIỂN',url,'primary')]])
    });
  }
  if(action==='admin-unavailable') throw new Error('Hãy cấu hình MINI_APP_URL trong Render Environment.');
  if(action==='live') return showLive(ctx,userId,config,pendingInputs,botKey);
  if(action==='live-accounts') return showLiveAccounts(ctx,userId);
  if(action==='legacy-unavailable') throw new Error('Phiên bản web cũ chưa được cấu hình LEGACY_ACCOUNT_URL và LEGACY_SESSION_SECRET.');
  if(action==='tools') return sendCatalog(ctx,userId,'tools','🧰 HỆ THỐNG THUÊ TOOL AUTOMATION',config,{botKey,adminId},pendingInputs);
  if(action==='codes') return sendCatalog(ctx,userId,'codes','🎁 MUA LÌ XÌ · CODE MÀN · CODE TELE',config,{botKey,adminId},pendingInputs);
  if(action==='otp') return sendCatalog(ctx,userId,'otp','⚙️ TIỆN ÍCH OTP & INFRA PROXY',config,{botKey,adminId},pendingInputs);
  if(action==='viptools') return sendCatalog(ctx,userId,'vip','🏆 VIP KHO CÔNG CỤ ĐẶC QUYỀN',config,{botKey,adminId},pendingInputs);
  if(action==='wallet') {
    pendingInputs.set(userId,{type:'wallet',expiresAt:Date.now()+INPUT_TTL_MS});
    const user=await getUser(userId);
    return ctx.reply('💳 <b>CỔNG NẠP TIỀN</b>\nSố dư hiện tại: <b>'+money(user&&user.balance)+'</b>\nNhập số tiền muốn nạp, ví dụ <code>50000</code>. Tối thiểu 10.000 VNĐ.',{parse_mode:'HTML'});
  }
  if(action==='deposit-history') return showDepositHistory(ctx,userId);
  if(action==='customer') return showCustomer(ctx,userId);
  if(action==='orders') return showOrders(ctx,userId);
  if(action==='duel') return showDuel(ctx,userId,bot,config);
  if(action==='duel-leave') {
    const result=await pool.query("UPDATE matchmaking_queue SET status='cancelled',updated_at=NOW() WHERE user_id=$1 AND status='waiting' RETURNING id",[userId]);
    return ctx.reply(result.rowCount?'Đã rời hàng chờ ghép đối đầu.':'Bạn hiện không có lượt chờ.');
  }
  if(action==='ref') {
    const [count,reward,settings]=await Promise.all([
      pool.query('SELECT COUNT(*)::int AS total FROM users WHERE ref_by=$1',[userId]),
      pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM wallet_ledger WHERE user_id=$1 AND transaction_type='REFERRAL_REWARD'",[userId]),
      getSettings(['referral_commission_percent'])
    ]);
    let username=String(process.env.BOT_USERNAME||'').replace(/^@/,'');
    if(!username) { try { username=(await bot.api.getMe()).username||''; } catch {} }
    const link=username?'https://t.me/'+username+'?start=ref_'+userId:'';
    return ctx.reply('🎊 <b>GIỚI THIỆU REF</b>\n👥 Thành viên đã mời: <b>'+count.rows[0].total+'</b>\n💰 Hoa hồng đã nhận: <b>'+money(reward.rows[0].total)+'</b>\n📊 Tỷ lệ: <b>'+Number(settings.referral_commission_percent||0)+'%</b>\n'+(link?'<code>'+escapeHtml(link)+'</code>':'Chưa xác định username bot.'),{
      parse_mode:'HTML',
      reply_markup:inlineKeyboard([[urlButton('📤 MỞ LINK GIỚI THIỆU',link,'success')],[callbackButton('🏠 MENU CHÍNH','member:home','primary')]])
    });
  }
  if(action==='vip') {
    const user=await getUser(userId);
    const products=await pool.query("SELECT id,name,price FROM products WHERE category='vip' AND is_active=TRUE ORDER BY price ASC LIMIT 20");
    const items=products.rows.map(row=>({label:row.name+' · '+money(row.price),data:'member:order:'+row.id,style:'success'}));
    items.push({label:'🏠 MENU CHÍNH',data:'member:home',style:'primary'});
    const rows=chunk(items,Math.min(3,Math.max(1,Number(config.menu_columns||2))));
    return ctx.reply('👑 <b>TRUNG TÂM VIP</b>\nCấp hiện tại: <b>VIP '+Number(user.vip_level||0)+'</b>\nTổng nạp: <b>'+money(user.total_deposited)+'</b>\nGói VIP đang mở bán: '+products.rowCount,{
      parse_mode:'HTML',
      reply_markup:inlineKeyboard(rows.map(row=>row.map(item=>callbackButton(item.label,item.data,item.style))))
    });
  }
  if(action==='group'||action==='news') {
    const key=action==='group'?'GROUP_URL':'CHANNEL_URL';
    const settings=await getSettings([key]);
    const url=settings[key]||process.env[key]||'';
    if(!/^https:\/\//i.test(url)) throw new Error('Admin chưa cấu hình '+key+'.');
    return ctx.reply('🔗 <b>'+(action==='group'?'NHÓM CHAT':'KÊNH THÔNG BÁO')+'</b>',{
      parse_mode:'HTML',
      reply_markup:inlineKeyboard([[urlButton(action==='group'?'🗣️ MỞ NHÓM CHAT':'📢 MỞ KÊNH',url,'primary')]])
    });
  }
  if(action==='gift') {
    pendingInputs.set(userId,{type:'giftcode',expiresAt:Date.now()+INPUT_TTL_MS});
    return ctx.reply('🎟️ Vui lòng nhập mã Giftcode trong vòng 10 phút.');
  }
  if(action==='support') {
    pendingInputs.set(userId,{type:'support',expiresAt:Date.now()+INPUT_TTL_MS});
    return ctx.reply('🧑‍💻 Hãy mô tả vấn đề cần hỗ trợ. Bot sẽ tạo ticket và gửi thông tin cho Admin.');
  }
  if(action==='link-new') {
    const actionMap=new Map();
    const labels=ALLOWED_BRANDS.map(brand=>{
      actionMap.set(brand,'select-brand:'+brand);
      return brand;
    });
    pendingInputs.set(userId,{type:'action_map',actions:actionMap,expiresAt:Date.now()+INPUT_TTL_MS});
    return ctx.reply('👉 Vui lòng chọn hệ thống muốn liên kết:',{
      reply_markup:replyKeyboard(chunk(labels.map(label=>replyButton(label,'primary')),2),{resize:true,persistent:true,placeholder:'Chọn thương hiệu'})
    });
  }
  if(action.startsWith('select-brand:')) {
    const brand=action.slice('select-brand:'.length).toUpperCase();
    if(!ALLOWED_BRANDS.includes(brand)) throw new Error('Thương hiệu không hợp lệ.');
    pendingInputs.set(userId,{type:'link_username',brand,expiresAt:Date.now()+INPUT_TTL_MS});
    return ctx.reply('✍️ Bạn đã chọn <b>'+escapeHtml(brand)+'</b>. Hãy nhập tên đăng nhập. Không gửi mật khẩu hoặc OTP.',{parse_mode:'HTML'});
  }
  if(action.startsWith('link-delete:')) {
    const id=action.slice('link-delete:'.length);
    if(!/^\d{1,18}$/.test(id)) throw new Error('ID liên kết không hợp lệ.');
    await pool.query('DELETE FROM linked_accounts WHERE id=$1 AND user_id=$2',[id,userId]);
    return showLiveAccounts(ctx,userId);
  }
  if(action.startsWith('duel-finish:')) {
    const id=action.slice('duel-finish:'.length);
    const result=await pool.query("UPDATE matchmaking_matches SET status='completed',finished_at=NOW() WHERE id=$1 AND status='matched' AND (player_one=$2 OR player_two=$2) RETURNING player_one,player_two",[id,userId]);
    if(!result.rowCount) throw new Error('Không tìm thấy lượt ghép đang hoạt động.');
    await pool.query("UPDATE matchmaking_queue SET status='completed',updated_at=NOW() WHERE match_id=$1",[id]);
    const other=result.rows[0].player_one===String(userId)?result.rows[0].player_two:result.rows[0].player_one;
    try { await bot.api.sendMessage(other,'Lượt ghép đối đầu #'+id+' đã kết thúc.'); } catch {}
    return ctx.reply('Đã kết thúc lượt ghép đối đầu #'+escapeHtml(id)+'.');
  }
  if(action==='menu-settings') {
    if(String(userId)!==String(adminId)) throw new Error('Bạn không có quyền quản trị.');
    const url=getMiniAppUrl('admin',botKey);
    return ctx.reply('🛡️ Cấu hình menu và màu nút được quản lý trong tab “Menu & Bot”.',{
      reply_markup:inlineKeyboard([[inlineWebAppButton('MỞ CẤU HÌNH MENU',url,'primary')]])
    });
  }
  throw new Error('Chức năng không hợp lệ. Hãy chọn lại menu chính.');
}

async function processPendingText(ctx,state,bot,botContext,config,pendingInputs) {
  const userId=String(ctx.from.id);
  const input=String(ctx.message.text||'').trim();
  if(!input || input.startsWith('/')) return false;

  if(state.type==='action_map') {
    const action=state.actions && state.actions.get(input);
    if(action) {
      pendingInputs.delete(userId);
      await dispatchAction(ctx,action,{...botContext,config,pendingInputs,userId});
      return true;
    }
    return false;
  }

  if(state.type==='wallet') {
    if(!/^\d{4,12}$/.test(input)) {
      await ctx.reply('⚠️ Nhập số tiền bằng chữ số, ví dụ 50000.');
      return true;
    }
    pendingInputs.delete(userId);
    await showDeposit(ctx,userId,Number(input),config);
    return true;
  }

  if(state.type==='link_username') {
    if(input.length<3 || input.length>64 || /[\u0000-\u001f]/.test(input)) {
      await ctx.reply('Tên đăng nhập phải từ 3 đến 64 ký tự. Không gửi mật khẩu hoặc OTP.');
      return true;
    }
    await pool.query(
      'INSERT INTO linked_accounts (user_id,brand,username) VALUES ($1,$2,$3) ON CONFLICT (user_id,brand,username) DO NOTHING',
      [userId,state.brand,input]
    );
    pendingInputs.delete(userId);
    await ctx.reply('🎉 Đã liên kết '+escapeHtml(state.brand)+' · <code>'+escapeHtml(input)+'</code>.',{parse_mode:'HTML'});
    return true;
  }

  if(state.type==='giftcode') {
    pendingInputs.delete(userId);
    try {
      const reward=await createGiftcodeRedemption(userId,input);
      await ctx.reply('🎉 Kích hoạt Giftcode thành công. Ví được cộng <b>'+money(reward)+'</b>.',{parse_mode:'HTML'});
    } catch(error) {
      await ctx.reply('❌ Giftcode không hợp lệ: '+escapeHtml(error.message),{parse_mode:'HTML'});
    }
    return true;
  }

  if(state.type==='support') {
    pendingInputs.delete(userId);
    if(input.length<5) {
      await ctx.reply('Nội dung cần ít nhất 5 ký tự.');
      return true;
    }
    const ticket=await pool.query(
      "INSERT INTO support_tickets (user_id,subject,message) VALUES ($1,$2,$3) RETURNING id",
      [userId,'Yêu cầu hỗ trợ Telegram',input.slice(0,3000)]
    );
    const ticketId=ticket.rows[0].id;
    if(botContext.adminId) {
      try {
        await bot.api.sendMessage(botContext.adminId,'🆕 YÊU CẦU CSKH #'+ticketId+'\nTelegram ID: '+userId+'\nNội dung:\n'+input.slice(0,2500));
      } catch(error) {
        console.warn('Không gửi được thông báo CSKH cho Admin:',error.message);
      }
    }
    await ctx.reply('✅ Đã tạo yêu cầu hỗ trợ #'+ticketId+'. CSKH sẽ phản hồi qua Telegram.');
    return true;
  }
  return false;
}

function setupBotClient(bot,options={}) {
  const botKey=options.botKey||'primary';
  const adminId=String(options.adminId||process.env.ADMIN_ID||'');
  const pendingInputs=new Map();
  const cooldowns=new Map();
  const botContext={bot,botKey,adminId};

  bot.command('start',async ctx=>{
    const userId=String(ctx.from.id);
    const payload=String(ctx.match||'');
    const ref=payload.startsWith('ref_')?payload.slice(4):'';
    const refBy=/^\d{5,20}$/.test(ref)&&ref!==userId?ref:null;
    const user=await getUser(
      userId,
      [ctx.from.first_name,ctx.from.last_name].filter(Boolean).join(' '),
      ctx.from.username,
      refBy
    );
    pendingInputs.delete(userId);
    const config=await getBotMenuConfig(botKey);
    const accounts=await getLinkedAccounts(userId);
    ctx.state={...(ctx.state||{}),adminId,linkedCount:accounts.length};
    const keyboard=buildMenuKeyboard(config,userId,adminId,botKey);
    await ctx.reply(formatWelcome(ctx,userId,user,config),{
      parse_mode:'HTML',
      disable_web_page_preview:true,
      reply_markup:keyboard
    });
  });

  bot.command('menu',async ctx=>{
    const config=await getBotMenuConfig(botKey);
    await sendHome(ctx,String(ctx.from.id),{botKey,adminId},config);
  });

  bot.command('help',async ctx=>{
    await ctx.reply([
      '🤖 <b>HENDY BOT</b>',
      '/start — Mở menu chính',
      '/menu — Hiển thị lại menu',
      '/orders — Xem đơn hàng',
      '/admin — Mở bảng quản trị (chỉ Admin)',
      '/help — Hướng dẫn sử dụng',
      '',
      'Bấm nút màu ở bàn phím phía dưới để mở từng chức năng.'
    ].join('\n'),{parse_mode:'HTML'});
  });

  bot.command('orders',async ctx=>{
    await showOrders(ctx,String(ctx.from.id));
  });

  bot.command('admin',async ctx=>{
    const userId=String(ctx.from.id);
    if(!adminId || userId!==adminId) return ctx.reply('⛔ Bạn không có quyền quản trị.');
    const url=getMiniAppUrl('admin',botKey);
    if(!url) return ctx.reply('⚠️ Hãy cấu hình MINI_APP_URL trong Render Environment.');
    return ctx.reply('🛡️ <b>BẢNG ĐIỀU KHIỂN ADMIN</b>',{
      parse_mode:'HTML',
      reply_markup:inlineKeyboard([[inlineWebAppButton('MỞ BẢNG QUẢN TRỊ',url,'primary')]])
    });
  });

  bot.callbackQuery(/^member:(.+)$/,async ctx=>{
    await ctx.answerCallbackQuery().catch(()=>{});
    const userId=String(ctx.from.id);
    const action=String(ctx.match[1]||'');
    const last=cooldowns.get(userId)||0;
    if(Date.now()-last<250) return;
    cooldowns.set(userId,Date.now());
    const config=await getBotMenuConfig(botKey);
    try {
      if(action.startsWith('order:')) {
        const order=await createMemberOrder(userId,action.slice('order:'.length));
        return ctx.reply([
          '✅ <b>ĐÃ TẠO ĐƠN HÀNG</b>',
          'Sản phẩm: <b>'+escapeHtml(order.product_name)+'</b>',
          'Mã đơn: <code>'+escapeHtml(order.order_code)+'</code>',
          'Số tiền: '+money(order.amount),
          'Trạng thái: Chờ Admin xử lý.',
          'Số dư còn lại: '+money(order.balance)
        ].join('\n'),{parse_mode:'HTML',reply_markup:inlineKeyboard([
          [callbackButton('🧾 LỊCH SỬ ĐƠN HÀNG','member:orders','primary')],
          [callbackButton('🏠 MENU CHÍNH','member:home','primary')]
        ])});
      }
      await dispatchAction(ctx,action,{...botContext,config,pendingInputs,userId});
    } catch(error) {
      console.error('Lỗi xử lý callback bot '+botKey+':',error.message);
      await ctx.reply('❌ '+escapeHtml(error.message||'Không thể xử lý yêu cầu.'),{parse_mode:'HTML'});
    }
  });

  bot.on('message:text',async(ctx,next)=>{
    const userId=String(ctx.from.id);
    const state=pendingInputs.get(userId);
    const input=String(ctx.message.text||'').trim();

    if(state && Date.now()>state.expiresAt) pendingInputs.delete(userId);
    else if(state && await processPendingText(ctx,state,bot,botContext,await getBotMenuConfig(botKey),pendingInputs)) return;

    const config=await getBotMenuConfig(botKey);
    const action=actionForText(input,config,userId,adminId);
    if(!action) return next();
    try {
      await dispatchAction(ctx,action,{...botContext,config,pendingInputs,userId});
    } catch(error) {
      console.error('Lỗi xử lý reply keyboard bot '+botKey+':',error.message);
      await ctx.reply('❌ '+escapeHtml(error.message||'Không thể xử lý yêu cầu.'),{parse_mode:'HTML'});
    }
  });
}

module.exports={
  setupBotClient,
  getBotMenuConfig,
  getMenuItems,
  buildMenuKeyboard,
  getMiniAppUrl,
  DEFAULT_MENU_ITEMS
};
