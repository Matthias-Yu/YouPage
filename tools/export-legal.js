// 把小程序里的隐私政策、用户协议导出成 txt，放到 docs/ 下。
// 隐私政策那份可以在公众平台「用户隐私保护指引 → 补充文档」上传（只收 txt，100KB 以内）。
// 用法：$env:ELECTRON_RUN_AS_NODE='1'; & "<微信开发者工具.exe>" tools\export-legal.js
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const legal = require(path.join(root, 'miniprogram', 'utils', 'legal.js'))
const out = path.join(root, 'docs')
if (!fs.existsSync(out)) fs.mkdirSync(out)

const files = [
  ['有页隐私政策.txt', legal.toText(legal.privacy())],
  ['有页用户协议.txt', legal.toText(legal.terms())]
]
files.forEach(([name, text]) => {
  fs.writeFileSync(path.join(out, name), text, 'utf8')
  fs.writeSync(1, name + '  ' + Buffer.byteLength(text, 'utf8') + ' bytes\n')
})
if (!legal.ready()) fs.writeSync(1, '注意：miniprogram/config.js 里的 OPERATOR / CONTACT_EMAIL 还没填，文件里是「待填写」。\n')
