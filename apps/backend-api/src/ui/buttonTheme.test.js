const test = require('node:test');
const assert = require('node:assert/strict');
const { BUTTON_STYLES, callbackButton, urlButton, webAppButton, withStyle } = require('./buttonTheme');

test('Telegram button theme exposes the three supported styles', () => {
  assert.deepEqual(Object.values(BUTTON_STYLES), ['primary', 'success', 'danger']);
});

test('callback, URL and WebApp buttons receive color styles', () => {
  const callback = callbackButton('Menu', 'member:home', 'primary');
  const url = urlButton('Group', 'https://t.me/example', 'success');
  const webApp = webAppButton('Admin', 'https://example.com/?section=admin', 'danger');

  assert.equal(callback.callback_data, 'member:home');
  assert.equal(callback.style, 'primary');
  assert.equal(url.url, 'https://t.me/example');
  assert.equal(url.style, 'success');
  assert.equal(webApp.web_app.url, 'https://example.com/?section=admin');
  assert.equal(webApp.style, 'danger');
});

test('unknown style safely falls back to primary', () => {
  assert.equal(withStyle({ text: 'Test', callback_data: 'test' }, 'purple').style, 'primary');
});
