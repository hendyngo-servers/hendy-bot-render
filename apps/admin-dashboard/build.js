const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const source = path.join(root, 'index.html');
const output = path.join(root, 'dist');
const styles = path.join(root, 'styles');
const html = fs.readFileSync(source, 'utf8');

const inlineScripts = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))
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
for (const token of ['--btn-primary-start', '--btn-success-start', '--btn-danger-start', '.primary', '.secondary', '.danger']) {
  if (!css.includes(token)) throw new Error('Thiếu cấu hình màu nút: ' + token);
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(source, path.join(output, 'index.html'));
fs.cpSync(styles, path.join(output, 'styles'), { recursive: true });

if (!fs.existsSync(path.join(output, 'styles', 'buttons.css'))) {
  throw new Error('Không copy được styles/buttons.css vào thư mục dist.');
}
console.log('Đã kiểm tra JavaScript, theme nút bấm và build dashboard cùng styles/buttons.css.');
