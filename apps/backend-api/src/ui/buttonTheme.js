const { InlineKeyboard, Keyboard } = require('grammy');

const BUTTON_STYLES = Object.freeze({
  primary: 'primary',
  success: 'success',
  danger: 'danger'
});

function resolveStyle(style) {
  return BUTTON_STYLES[style] || BUTTON_STYLES.primary;
}

function callbackButton(text, callbackData, style = 'primary') {
  return {
    text: String(text),
    callback_data: String(callbackData),
    style: resolveStyle(style)
  };
}

function urlButton(text, url, style = 'primary') {
  return {
    text: String(text),
    url: String(url),
    style: resolveStyle(style)
  };
}

function inlineWebAppButton(text, url, style = 'primary') {
  return {
    text: String(text),
    web_app: { url: String(url) },
    style: resolveStyle(style)
  };
}

function replyButton(text, style = 'primary') {
  return Keyboard.text(String(text), resolveStyle(style));
}

function replyWebAppButton(text, url, style = 'primary') {
  return Keyboard.webApp(
    { text: String(text), style: resolveStyle(style) },
    String(url)
  );
}

function inlineKeyboard(rows) {
  return InlineKeyboard.from(rows);
}

function replyKeyboard(rows, options = {}) {
  let keyboard = Keyboard.from(rows);
  if (options.resize !== false) keyboard = keyboard.resized();
  if (options.persistent !== false) keyboard = keyboard.persistent();
  if (options.placeholder) keyboard = keyboard.placeholder(String(options.placeholder).slice(0, 64));
  return keyboard;
}

module.exports = {
  BUTTON_STYLES,
  resolveStyle,
  callbackButton,
  urlButton,
  inlineWebAppButton,
  replyButton,
  replyWebAppButton,
  inlineKeyboard,
  replyKeyboard
};
