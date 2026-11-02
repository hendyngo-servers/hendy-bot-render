const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const source = path.join(root, 'index.html');
const output = path.join(root, 'dist');
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

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(source, path.join(output, 'index.html'));

console.log('Đã kiểm tra ' + inlineScripts.length + ' khối JavaScript và build dashboard vào apps/admin-dashboard/dist.');
