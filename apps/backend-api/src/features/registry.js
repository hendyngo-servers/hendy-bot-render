'use strict';

const path = require('path');
const FEATURE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

async function registerEnabledFeatures(names,context) {
  const enabled=Array.isArray(names)?names:[];
  const results=[];
  for(const name of enabled) {
    if(!FEATURE_NAME.test(String(name))||String(name).length>40) throw new Error('Tên feature được bật không hợp lệ: '+name);
    const modulePath=path.join(__dirname,String(name),'index.js');
    // Only repository-owned modules from an explicit allowlist are loaded.
    // Never accept module paths or filenames from an HTTP request.
    const feature=require(modulePath);
    if(!feature||typeof feature.register!=='function') throw new Error('Feature '+name+' phải export hàm register(context).');
    results.push(await feature.register(context));
  }
  return results;
}

module.exports={registerEnabledFeatures};
