const fs = require('fs');
const path = require('path');

const ALLOWED_CATEGORIES = new Set(['api','bot','dashboard']);
const FEATURE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function validateFeatureName(name) {
  const value=String(name||'').trim();
  if(!FEATURE_NAME.test(value)||value.length>40) {
    throw new Error('Tên tính năng phải là slug chữ thường, ví dụ order-history hoặc vip-tools.');
  }
  return value;
}

function buildFeatureFiles({name,category,description}) {
  const slug=validateFeatureName(name);
  const type=String(category||'api');
  if(!ALLOWED_CATEGORIES.has(type)) throw new Error('Loại tính năng phải là api, bot hoặc dashboard.');
  const title=slug.split('-').map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ');
  const summary=String(description||'Mô tả mục tiêu, API và quyền truy cập của tính năng mới.').trim().slice(0,500);
  const base=type==='dashboard'
    ?path.posix.join('apps/admin-dashboard/features',slug)
    :path.posix.join('apps/backend-api/src/features',slug);
  const files={};
  files[path.posix.join(base,'README.md')]=[
    '# '+title,'','Loại: '+type,'',summary,'',
    '## Checklist trước khi bật',
    '- [ ] Xác định quyền người dùng/Admin.',
    '- [ ] Xác thực và kiểm tra dữ liệu đầu vào.',
    '- [ ] Thêm migration nếu cần thay đổi PostgreSQL.',
    '- [ ] Thêm unit/integration tests.',
    '- [ ] Cập nhật tài liệu API và cấu hình.',
    '- [ ] Không đưa secret vào source code hoặc log.',''
  ].join('\n');
  files[path.posix.join(base,'feature.json')]=JSON.stringify({
    name:slug,title,category:type,enabled:false,
    createdBy:'github-actions-scaffold',description:summary
  },null,2)+'\n';
  files[path.posix.join(base,'index.js')]=type==='dashboard'
    ?[
      "'use strict';",'',
      '// Dashboard feature entry point. Import this module explicitly from the dashboard app.',
      'export function mount'+title.replace(/[^A-Za-z0-9]/g,'')+'Feature(root, context) {',
      "  if (!root) throw new Error('Feature root element is required.');",
      "  root.dataset.feature = '"+slug+"';",
      '  // TODO: render this feature using the authenticated dashboard API.',
      '  return () => { delete root.dataset.feature; };','}'
    ].join('\n')+'\n'
    :[
      "'use strict';",'',
      '// Register this feature explicitly in src/features/registry.js after review.',
      'async function register'+title.replace(/[^A-Za-z0-9]/g,'')+'(context) {',
      "  if (!context || !context.pool) throw new Error('Feature context with PostgreSQL pool is required.');",
      '  // TODO: add bot handlers or API routes after defining authorization and validation.',
      "  return { name: '"+slug+"', enabled: false };",
      '}','',
      'module.exports = { register };',''
    ].join('\n');
  if(type!=='dashboard') {
    files[path.posix.join(base,'index.test.js')]=[
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const feature = require('./index');",'',
      "test('feature scaffold exports a registration function', () => {",
      "  assert.equal(typeof feature.register, 'function');",
      '});',''
    ].join('\n');
  }
  return files;
}

function writeFeature(options,cwd=process.cwd()) {
  const files=buildFeatureFiles(options);
  const written=[];
  for(const [relativePath,content] of Object.entries(files)) {
    const destination=path.resolve(cwd,relativePath);
    const root=path.resolve(cwd);
    if(!destination.startsWith(root+path.sep)) throw new Error('Đường dẫn scaffold vượt khỏi repository.');
    if(fs.existsSync(destination)) throw new Error('Không ghi đè tệp đã tồn tại: '+relativePath);
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.writeFileSync(destination,content,{flag:'wx'});
    written.push(relativePath);
  }
  return written;
}

function readArgs(argv) {
  const args={};
  for(let i=0;i<argv.length;i++) if(argv[i].startsWith('--')) args[argv[i].slice(2)]=argv[i+1]||'';
  return args;
}

if(require.main===module) {
  try {
    const args=readArgs(process.argv.slice(2));
    const written=writeFeature({name:args.name,category:args.category,description:args.description});
    console.log('Đã tạo scaffold tính năng:');
    for(const file of written) console.log(' - '+file);
    console.log('Tệp mới ở trạng thái disabled; review, bổ sung test và đăng ký module thủ công trước khi bật.');
  } catch(error) {
    console.error('Không thể tạo scaffold:',error.message);
    process.exitCode=1;
  }
}

module.exports={validateFeatureName,buildFeatureFiles,writeFeature};
