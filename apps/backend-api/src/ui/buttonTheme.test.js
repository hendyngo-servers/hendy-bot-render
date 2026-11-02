const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BUTTON_STYLES,
  resolveStyle,
  callbackButton,
  urlButton,
  inlineWebAppButton,
  replyButton,
  replyWebAppButton,
  inlineKeyboard,
  replyKeyboard
} = require('./buttonTheme');

test('button styles are the Telegram semantic palette', () => {
  assert.deepEqual(Object.values(BUTTON_STYLES), ['primary', 'success', 'danger']);
  assert.equal(resolveStyle('unknown'), 'primary');
});

test('inline buttons preserve callback, URL, WebApp and color values', () => {
  assert.deepEqual(callbackButton('Menu', 'member:home', 'primary'), {
    text: 'Menu', callback_data: 'member:home', style: 'primary'
  });
  assert.deepEqual(urlButton('Group', 'https://t.me/example', 'success'), {
    text: 'Group', url: 'https://t.me/example', style: 'success'
  });
  assert.deepEqual(inlineWebAppButton('Admin', 'https://example.com/admin', 'danger'), {
    text: 'Admin', web_app: { url: 'https://example.com/admin' }, style: 'danger'
  });
});

test('reply keyboard builders produce persistent grids with styled buttons', () => {
  const rowA = replyButton('Live', 'primary');
  const rowB = replyButton('Wallet', 'success');
  const keyboard = replyKeyboard([[rowA, rowB]], {
    resize: true,
    persistent: true,
    placeholder: 'Chọn dịch vụ'
  });
  const json = keyboard.build();
  assert.equal(json[0][0].text, 'Live');
  assert.equal(json[0][0].style, 'primary');
  assert.equal(json[0][1].style, 'success');
  assert.equal(typeof replyWebAppButton('Admin', 'https://example.com', 'primary'), 'object');
});

test('inline keyboard builder accepts a grid of action rows', () => {
  const keyboard = inlineKeyboard([[callbackButton('Home', 'member:home')]]);
  assert.equal(keyboard.build()[0][0].callback_data, 'member:home');
});
