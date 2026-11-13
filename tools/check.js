// Static + logic checks for the mini program, run with the DevTools' bundled Node.
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const root = process.argv[2]
let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('  FAIL ' + msg) } else console.log('  ok   ' + msg) }

function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const files = walk(root, [])

console.log('== syntax')
for (const f of files.filter(f => /\.(js|wxs)$/.test(f))) {
  try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }) } catch (e) { fail++; console.log('  FAIL ' + f + ': ' + e.message) }
}
for (const f of files.filter(f => /\.json$/.test(f))) {
  try { JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { fail++; console.log('  FAIL ' + f + ': ' + e.message) }
}
console.log('  checked ' + files.filter(f => /\.(js|wxs|json)$/.test(f)).length + ' files')

console.log('== wxml: tags balanced, handlers exist, assets exist')
const VOID = new Set(['image', 'asset-image', 'input', 'textarea', 'import', 'include', 'wxs', 'switch', 'deco-layer'])
for (const f of files.filter(f => /\.wxml$/.test(f))) {
  const src = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const stack = []
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let m
  while ((m = re.exec(src))) {
    const [, close, tag, , self] = m
    if (close) { const top = stack.pop(); if (top !== tag) { fail++; console.log('  FAIL ' + path.basename(path.dirname(f)) + ': </' + tag + '> closes <' + top + '>') } }
    else if (!self) stack.push(tag)
  }
  if (stack.length) { fail++; console.log('  FAIL ' + f + ': unclosed ' + stack.join(',')) }
  // event handlers referenced in wxml must exist in the js next to it
  const js = fs.readFileSync(f.replace(/\.wxml$/, '.js'), 'utf8')
  const handlers = new Set()
  src.replace(/(?:bind|catch)[:\w]*="([A-Za-z_]\w*)"/g, (_, h) => handlers.add(h))
  for (const h of handlers) if (!new RegExp('\\b' + h + '\\s*\\(').test(js)) { fail++; console.log('  FAIL ' + path.relative(root, f) + ': handler ' + h + ' not found') }
  // static asset paths
  src.replace(/src="(\/assets\/[^"{]+)"/g, (_, p) => { if (!fs.existsSync(path.join(root, p))) { fail++; console.log('  FAIL missing asset ' + p) } })
}

console.log('== catalog assets exist')
global.wx = null
const catalog = require(path.join(root, 'utils/catalog.js'))
const atlas = require(path.join(root, 'scene/atlas.js'))
const keys = [].concat(...catalog.PACKS.map(p => p.keys), catalog.MOODS.map(m => m.key), catalog.WEATHERS.map(w => w.key), catalog.HABIT_ICONS)
for (const k of keys) {
  if (!fs.existsSync(path.join(root, catalog.src(k)))) { fail++; console.log('  FAIL missing sticker ' + k) }
  if (!atlas.map[k]) { fail++; console.log('  FAIL missing sticker atlas cell ' + k) }
}
for (let month = 1; month <= 12; month++) {
  const key = 'month-' + String(month).padStart(2, '0')
  if (!atlas.map[key]) { fail++; console.log('  FAIL missing month illustration ' + key) }
}
ok(catalog.stickerKey('w-ddl') === 's05' && catalog.stickerKey('wx-rain') === 's40' &&
  catalog.stickerKey('mood-happy') === 's19' && catalog.isWide('w-ddl'), 'saved sticker IDs resolve to new artwork')
console.log('  ' + keys.length + ' sticker refs checked')
const member = require(path.join(root, 'utils/member.js'))
for (const b of member.BENEFITS) if (!fs.existsSync(path.join(root, catalog.src(b.icon)))) { fail++; console.log('  FAIL missing benefit icon ' + b.icon) }

console.log('== date')
const date = require(path.join(root, 'utils/date.js'))
const L = (y, m, d) => { const lu = date.lunar(y, m, d); return date.lunarText(lu) + '|' + date.festival(y, m, d, lu) }
ok(L(2026, 2, 17) === '正月初一|春节', '2026-02-17 ' + L(2026, 2, 17))
ok(L(2026, 2, 16) === '腊月廿九|除夕', '2026-02-16 ' + L(2026, 2, 16))
ok(L(2027, 2, 6) === '正月初一|春节', '2027-02-06 ' + L(2027, 2, 6))
ok(L(2027, 2, 5) === '腊月廿九|除夕', '2027-02-05 ' + L(2027, 2, 5))
ok(L(2030, 2, 3) === '正月初一|春节', '2030-02-03 ' + L(2030, 2, 3))
ok(L(2028, 1, 26) === '正月初一|春节', '2028-01-26 ' + L(2028, 1, 26))
ok(L(2026, 9, 25) === '八月十五|中秋', '2026-09-25 ' + L(2026, 9, 25))
ok(L(2027, 9, 15) === '八月十五|中秋', '2027-09-15 ' + L(2027, 9, 15))
ok(L(2026, 6, 19) === '五月初五|端午', '2026-06-19 ' + L(2026, 6, 19))
ok(L(2025, 7, 25) === '闰六月初一|', '2025-07-25 ' + L(2025, 7, 25))
ok(L(2026, 11, 12) === '十月初四|', '2026-11-12 ' + L(2026, 11, 12))
ok(L(2026, 4, 5).endsWith('|清明'), '2026-04-05 ' + L(2026, 4, 5))
ok(L(2028, 4, 4).endsWith('|清明'), '2028-04-04 ' + L(2028, 4, 4))
ok(L(2026, 12, 22).endsWith('|冬至'), '2026-12-22 ' + L(2026, 12, 22))
ok(L(2026, 10, 1).endsWith('|国庆'), '2026-10-01 ' + L(2026, 10, 1))
ok(date.lunar(2040, 1, 1) === null, 'out of range -> null')
// every day 2021..2036 resolves and day numbers are continuous
let prev = null, bad = 0
for (let t = Date.UTC(2021, 0, 1); t < Date.UTC(2037, 0, 1); t += 864e5) {
  const dt = new Date(t); const lu = date.lunar(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  if (!lu) { bad++; continue }
  if (prev && !(lu.day === prev.day + 1 || lu.day === 1)) bad++
  prev = lu
}
ok(bad === 0, 'lunar continuous 2021-2036 (bad=' + bad + ')')
const g = date.monthGrid(2026, 11, 1)
ok(g.length === 42 && g[6].d === 1 && g[6].wd === 0, 'grid 2026-11 mon-start: 6 rows, 1st is Sunday in last column')
const g0 = date.monthGrid(2026, 11, 0)
ok(g0.length === 35 && g0[0].d === 1, 'grid 2026-11 sun-start: 5 rows')
ok(date.addDays('2026-12-31', 1) === '2027-01-01' && date.addDays('2026-03-01', -1) === '2026-02-28', 'addDays')

console.log('== store (mock wx storage)')
const mem = {}
global.wx = {
  getStorageSync: k => (k in mem ? JSON.parse(mem[k]) : ''),
  setStorageSync: (k, v) => { mem[k] = JSON.stringify(v) },
  removeStorageSync: k => { delete mem[k] },
  getStorageInfoSync: () => ({ keys: Object.keys(mem) }),
  showToast() {}
}
const store = require(path.join(root, 'utils/store.js'))
const t = date.today()
store.saveDay(t.key, { mood: 'happy', weather: '', todos: [{ id: 'a', text: '买牛奶', done: true }], note: '第一行\n第二行', els: [{ id: 'e1', t: 's', k: 'star', x: 0.5, y: 0.5, s: 1, r: 0 }] })
store.saveDay(date.addDays(t.key, -1), { mood: '', weather: 'rain', todos: [], note: '', els: [] })
store.saveDay(date.addDays(t.key, -3), { mood: 'sad', weather: '', todos: [], note: 'x', els: [] })
const d0 = store.getDay(t.key)
ok(d0.mood === 'happy' && d0.todos.length === 1 && d0.els[0].k === 'star', 'saveDay/getDay round trip')
const sum = store.summary(d0)
ok(sum.snip === '第一行' && sum.todoN === 1 && sum.todoDone === 1 && sum.elN === 1, 'summary')
let st = store.stats()
ok(st.pages === 3 && st.streak === 2 && st.stickers === 1, 'stats ' + JSON.stringify(st))
store.saveDay(t.key, store.emptyDay())
st = store.stats()
ok(st.pages === 2 && st.streak === 1, 'emptied day is removed, streak counts from yesterday ' + JSON.stringify(st))
ok(store.getDay('2031-01-01').note === '' && store.summary(undefined) === null, 'missing day -> empty')
store.saveHabits([{ id: 'h1', name: '喝水', icon: 'coffee' }])
ok(store.toggleHabit('h1', t.key) === true && store.toggleHabit('h1', date.addDays(t.key, -1)) === true, 'toggleHabit on')
ok(store.habitStreak('h1') === 2 && store.isHabitDone('h1', t.key), 'habitStreak')
ok(store.toggleHabit('h1', t.key) === false && store.habitStreak('h1') === 1, 'toggleHabit off')
store.setSetting('weekStart', 0)
const backup = JSON.parse(JSON.stringify(store.exportAll()))
store.clearAll()
ok(store.stats().pages === 0 && store.getHabits().length === 0 && store.getSettings().weekStart === 0, 'clearAll (keeps this device\'s settings)')
ok(store.importAll(backup) === 2 && store.stats().pages === 2 && store.getHabits()[0].name === '喝水', 'export/import round trip')
let threw = false
try { store.importAll({ app: 'other', data: {} }) } catch (e) { threw = true }
ok(threw && store.stats().pages === 2, 'foreign backup rejected, data untouched')

console.log('== sound synthesis')
const sound = require(path.join(root, 'utils/sound.js'))
for (const name of Object.keys(sound.SYNTH)) {
  const buf = sound.SYNTH[name](44100)
  let peak = 0, bad = 0
  for (let i = 0; i < buf.length; i++) {
    if (!isFinite(buf[i])) bad++
    peak = Math.max(peak, Math.abs(buf[i]))
  }
  ok(bad === 0 && peak > 0.2 && peak <= 0.5 && buf.length > 2000 && buf.length < 44100 * 2,
    name + ': ' + (buf.length / 44100).toFixed(2) + 's peak ' + peak.toFixed(2))
}
ok(store.getSettings().sound === true && store.getSettings().tape === 'gingham', 'sound / tape defaults')

console.log('== legal')
const legal = require(path.join(root, 'utils/legal.js'))
const pv = legal.toText(legal.privacy()), tm = legal.toText(legal.terms())
ok(pv.length > 1000 && tm.length > 800 && Buffer.byteLength(pv) < 100 * 1024, 'privacy ' + pv.length + ' chars, terms ' + tm.length + ' chars')
ok(/剪切板/.test(pv) && /照片/.test(pv) && /聊天文件/.test(pv) && /删除云端数据/.test(pv), 'privacy policy covers photos, clipboard, chat files, cloud deletion')
if (!legal.ready()) console.log('  WARN config.js 的 OPERATOR / CONTACT_EMAIL 还没填，提交审核前必须填好')

console.log(fail ? '\n' + fail + ' FAILED' : '\nALL OK')
process.exit(fail ? 1 : 0)
