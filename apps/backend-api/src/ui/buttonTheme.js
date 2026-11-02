const { Markup } = require('telegraf');

const BUTTON_STYLES = Object.freeze({
  primary: 'primary',
  success: 'success',
  danger: 'danger'
});

function withStyle(button, style = 'primary') {
  return { ...button, style: BUTTON_STYLES[style] || BUTTON_STYLES.primary };
}

function callbackButton(text, data, style = 'primary') {
  return withStyle(Markup.button.callback(String(text), String(data)), style);
}

function urlButton(text, url, style = 'primary') {
  return withStyle(Markup.button.url(String(text), String(url)), style);
}

function webAppButton(text, url, style = 'primary') {
  return withStyle(Markup.button.webApp(String(text), String(url)), style);
}

function inlineKeyboard(rows) {
  return Markup.inlineKeyboard(rows);
}

module.exports = { BUTTON_STYLES, withStyle, callbackButton, urlButton, webAppButton, inlineKeyboard };
