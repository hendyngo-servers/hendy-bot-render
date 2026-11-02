const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const source = path.join(root, 'index.html');
const output = path.join(root, 'dist');
const styles = path.join(root, 'styles');
const html = fs.readFileSync(source, 'utf8');

const inlineScripts = Array.from(html.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi))
  .map(match => match[1].trim())
  .filter(Boolean);

if (inlineScripts.length === 0) {
  throw new Error('Dashboard không có JavaScript inline để kiểm tra.');
}
inlineScripts.forEach((script, index) => {
  new vm.Script(script, { filename: 'admin-dashboard-inline-' + (index + 1) + '.js' });
});

const cssPath = path.join(styles, 'buttons.css');
if (!fs.existsSync(cssPath)) throw new Error('Thiếu styles/buttons.css.');
const css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('--btn-primary-start') || !css.includes('.primary') || !css.includes('.danger')) {
  throw new Error('Theme nút bấm chưa có đủ màu primary và danger.');
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(source, path.join(output, 'index.html'));
fs.cpSync(styles, path.join(output, 'styles'), { recursive: true });

console.log('Đã kiểm tra JavaScript, theme nút bấm và build dashboard cùng styles/buttons.css.');
