const test=require('node:test');
const assert=require('node:assert/strict');
const {
  BUTTON_STYLES,resolveStyle,callbackButton,urlButton,inlineWebAppButton,
  replyButton,replyWebAppButton,inlineKeyboard,replyKeyboard
}=require('./buttonTheme');

test('Telegram buttons use primary, success and danger semantic styles',()=>{
  assert.deepEqual(Object.values(BUTTON_STYLES),['primary','success','danger']);
  assert.equal(resolveStyle('unknown'),'primary');
});
test('inline button builders keep action and style',()=>{
  assert.deepEqual(callbackButton('Menu','member:home','primary'),{text:'Menu',callback_data:'member:home',style:'primary'});
  assert.deepEqual(urlButton('Group','https://t.me/example','success'),{text:'Group',url:'https://t.me/example',style:'success'});
  assert.deepEqual(inlineWebAppButton('Admin','https://example.com/admin','danger'),{text:'Admin',web_app:{url:'https://example.com/admin'},style:'danger'});
});
test('reply keyboard builder returns persistent resized grid with styled buttons',()=>{
  const keyboard=replyKeyboard([[replyButton('Live','primary'),replyButton('Wallet','success')]],{
    resize:true,persistent:true,placeholder:'Chọn dịch vụ'
  });
  assert.equal(keyboard.keyboard[0][0].text,'Live');
  assert.equal(keyboard.keyboard[0][0].style,'primary');
  assert.equal(keyboard.keyboard[0][1].style,'success');
  assert.equal(keyboard.is_persistent,true);
  assert.equal(keyboard.resize_keyboard,true);
  assert.equal(keyboard.input_field_placeholder,'Chọn dịch vụ');
  assert.deepEqual(replyWebAppButton('Admin','https://example.com','primary'),{
    text:'Admin',web_app:{url:'https://example.com'},style:'primary'
  });
});
test('inline keyboard builder returns callback rows',()=>{
  const keyboard=inlineKeyboard([[callbackButton('Home','member:home')]]);
  assert.equal(keyboard.inline_keyboard[0][0].callback_data,'member:home');
});
