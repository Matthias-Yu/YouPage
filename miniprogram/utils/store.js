// 数据层：本机 wx storage 按月分片保存，页面只通过这里读写。
// 云同步（utils/sync.js）挂在这一层上：每次写入 / 删除可同步的 key，都会通知它。
//
//   yp:m:2026-11   { '12': { plan, mood, weather, todos:[{id,text,done}], note, els:[{id,t,k,x,y,s,r}], t } }
//                  plan 是直接写在月历格子里的那一句；t 是这一天最后修改的时间。
//                  清空了的一天会留一个 { gone: 1, t } 标记，好让别的设备也知道它被删了，读的时候过滤掉。
//   yp:d:2026-11   [{ id, t, k, x, y, s, r }]  贴在月历页上的贴纸 / 胶带
//   yp:i:2026-11   [{ tool, color, width, points: [x, y, ...] }] 月历页上的手绘笔迹
//   yp:habits      [{ id, name, icon }]
//   yp:h:2026-11   { habitId: { '12': 1 } }
//   ——以上五类会同步到云端——
//   yp:index       ['2026-11', ...]            有内容的月份（由月份数据推出来，不同步）
//   yp:settings    { cover, weekStart, sound, tape, sync }   这台设备自己的设置（不同步）

const date = require('./date')

const PREFIX = 'yp:'
const K_MONTH = PREFIX + 'm:'
const K_DECO = PREFIX + 'd:'
const K_INK = PREFIX + 'i:'
const EMPTY_INK = []
const K_INDEX = PREFIX + 'index'
const K_HABITS = PREFIX + 'habits'
const K_HLOG = PREFIX + 'h:'
const K_SETTINGS = PREFIX + 'settings'
const BACKUP_APP = 'youpage'
const SYNCABLE = /^yp:(m|d|i|h):\d{4}-\d{2}$|^yp:habits$/

let cache = {}
let hook = null

function read(key, def) {
  if (key in cache) return cache[key] === undefined ? def : cache[key]
  let v
  try {
    v = wx.getStorageSync(key)
  } catch (e) {
    console.error('[store] read failed', key, e)
  }
  if (v === '' || v === undefined || v === null) v = undefined
  cache[key] = v
  return v === undefined ? def : v
}

// reset: 这次是把整个 key 换掉（恢复备份），而不是在原来的基础上改
function write(key, val, reset) {
  cache[key] = val
  try {
    wx.setStorageSync(key, val)
  } catch (e) {
    console.error('[store] write failed', key, e)
    wx.showToast({ title: '保存失败，存储空间可能已满', icon: 'none' })
    return false
  }
  if (hook && SYNCABLE.test(key)) hook(key, !!reset)
  return true
}

function remove(key) {
  cache[key] = undefined
  try {
    wx.removeStorageSync(key)
  } catch (e) {}
  if (hook && SYNCABLE.test(key)) hook(key, true)
}

/* ---------- 给同步模块用的 ---------- */

// 每次本地改动了可同步的 key，都会调用 fn(key, reset)。
// reset 为 true 表示整个 key 被删掉或整体换掉了（清空、恢复备份），合并时不能把云端更早的内容再拼回来
function onLocalChange(fn) {
  hook = fn
}

function isSyncable(key) {
  return SYNCABLE.test(key)
}

// 读原始值（不存在时返回 undefined）
function peek(key) {
  return read(key, undefined)
}

// 写入来自云端的值，不触发同步钩子；val 为 undefined 表示删掉
function applyRemote(key, val) {
  cache[key] = val
  try {
    if (val === undefined) wx.removeStorageSync(key)
    else wx.setStorageSync(key, val)
  } catch (e) {
    console.error('[store] apply failed', key, e)
  }
}

// 本地有哪些可同步的 key
function syncableKeys() {
  return ownKeys().filter(k => SYNCABLE.test(k))
}

// 有内容的月份列表：从月份数据重新推一遍
function rebuildIndex() {
  const index = ownKeys()
    .filter(k => k.indexOf(K_MONTH) === 0 && Object.keys(getMonth(k.slice(K_MONTH.length))).length > 0)
    .map(k => k.slice(K_MONTH.length))
    .sort()
  write(K_INDEX, index)
}

/* ---------- 日页 ---------- */

function emptyDay() {
  return { plan: '', mood: '', weather: '', todos: [], note: '', els: [] }
}

function isEmptyDay(day) {
  return !(day.plan && day.plan.trim()) && !day.mood && !day.weather && !(day.note && day.note.trim()) &&
    !(day.todos && day.todos.length) && !(day.els && day.els.length)
}

// 含删除标记的原始月份数据
function rawMonth(ymKey) {
  return read(K_MONTH + ymKey, {})
}

// 一个月里有内容的那些天
function getMonth(ymKey) {
  const raw = rawMonth(ymKey)
  const out = {}
  for (const d in raw) if (raw[d] && !raw[d].gone) out[d] = raw[d]
  return out
}

function getDay(key) {
  const p = date.parse(key)
  const day = getMonth(date.ym(p.y, p.m))[p.d]
  return Object.assign(emptyDay(), day ? JSON.parse(JSON.stringify(day)) : null)
}

function saveDay(key, day) {
  const p = date.parse(key)
  const ymKey = date.ym(p.y, p.m)
  const month = Object.assign({}, rawMonth(ymKey))
  if (isEmptyDay(day)) {
    if (!month[p.d] || month[p.d].gone) return
    month[p.d] = { gone: 1, t: Date.now() }
  } else {
    month[p.d] = {
      plan: (day.plan || '').trim(),
      mood: day.mood || '', weather: day.weather || '', todos: day.todos || [],
      note: day.note || '', els: day.els || [], t: Date.now()
    }
  }
  write(K_MONTH + ymKey, month)
  const has = Object.keys(month).some(d => !month[d].gone)
  const index = getIndex()
  const at = index.indexOf(ymKey)
  if (has && at < 0) write(K_INDEX, index.concat(ymKey).sort())
  if (!has && at > -1) write(K_INDEX, index.filter(k => k !== ymKey))
}

function getIndex() {
  return read(K_INDEX, [])
}

// 月历格子、今日卡片用的摘要
function summary(day) {
  if (!day || day.gone) return null
  const todos = day.todos || []
  const plan = (day.plan || '').trim()
  let snip = plan || (day.note || '').trim().split('\n')[0]
  if (!snip && todos.length) snip = todos[0].text
  return {
    plan,
    mood: day.mood || '',
    weather: day.weather || '',
    snip: snip || '',
    todoN: todos.length,
    todoDone: todos.filter(t => t.done).length,
    elN: (day.els || []).length
  }
}

/* ---------- 月历页上的贴纸 ---------- */

function getMonthDeco(ymKey) {
  return read(K_DECO + ymKey, [])
}

function saveMonthDeco(ymKey, list) {
  write(K_DECO + ymKey, list)
}

function getMonthInk(ymKey) {
  const lines = read(K_INK + ymKey, EMPTY_INK)
  return Array.isArray(lines) ? lines : EMPTY_INK
}

function saveMonthInk(ymKey, lines) {
  const key = K_INK + ymKey
  const previous = read(key)
  if (write(key, lines)) return true
  cache[key] = previous
  return false
}

function stats() {
  let pages = 0, stickers = 0
  ownKeys().forEach(k => {
    if (k.indexOf(K_DECO) === 0) stickers += (read(k, []) || []).length
  })
  getIndex().forEach(ymKey => {
    const month = getMonth(ymKey)
    Object.keys(month).forEach(d => {
      pages++
      stickers += (month[d].els || []).length
    })
  })
  // 连续记录：今天还没写不算断，从昨天往回数
  const has = key => {
    const p = date.parse(key)
    return !!getMonth(date.ym(p.y, p.m))[p.d]
  }
  let cur = date.today().key
  if (!has(cur)) cur = date.addDays(cur, -1)
  let streak = 0
  while (streak < 3650 && has(cur)) {
    streak++
    cur = date.addDays(cur, -1)
  }
  return { pages, stickers, streak }
}

/* ---------- 打卡 ---------- */

function getHabits() {
  return read(K_HABITS, [])
}

function saveHabits(list) {
  write(K_HABITS, list)
}

function getHabitLog(ymKey) {
  return read(K_HLOG + ymKey, {})
}

function isHabitDone(id, key) {
  const p = date.parse(key)
  const log = getHabitLog(date.ym(p.y, p.m))[id]
  return !!(log && log[p.d])
}

function toggleHabit(id, key) {
  const p = date.parse(key)
  const ymKey = date.ym(p.y, p.m)
  const log = Object.assign({}, getHabitLog(ymKey))
  const days = Object.assign({}, log[id])
  const on = !days[p.d]
  if (on) days[p.d] = 1
  else delete days[p.d]
  log[id] = days
  write(K_HLOG + ymKey, log)
  return on
}

function habitStreak(id) {
  let cur = date.today().key
  if (!isHabitDone(id, cur)) cur = date.addDays(cur, -1)
  let n = 0
  while (n < 3650 && isHabitDone(id, cur)) {
    n++
    cur = date.addDays(cur, -1)
  }
  return n
}

/* ---------- 设置 ---------- */

// tape: 桌上那卷胶带当前的花色（utils/catalog.js 里 TAPES 的 id）
// sync: 这台设备是否参与云同步
// consentV / consentOk: 用户对哪一版隐私政策做了选择、是否同意（utils/consent.js）
const DEFAULT_SETTINGS = { cover: true, weekStart: 1, sound: true, tape: 'gingham', sync: true, consentV: '', consentOk: false }

function getSettings() {
  return Object.assign({}, DEFAULT_SETTINGS, read(K_SETTINGS, {}))
}

function setSetting(name, value) {
  const s = getSettings()
  s[name] = value
  write(K_SETTINGS, s)
  return s
}

/* ---------- 备份 / 恢复 / 清空 ---------- */

function ownKeys() {
  let keys = []
  try {
    keys = wx.getStorageInfoSync().keys || []
  } catch (e) {}
  return keys.filter(k => k.indexOf(PREFIX) === 0)
}

function exportAll() {
  const data = {}
  ownKeys().forEach(k => {
    data[k] = wx.getStorageSync(k)
  })
  return { app: BACKUP_APP, version: 1, exportedAt: new Date().toISOString(), data }
}

// 返回恢复的日页数量；文件不是有页备份时抛错。
// 恢复等于在这台设备上重写了整本手帐，开着云同步的话会覆盖到云端
function importAll(obj) {
  if (!obj || obj.app !== BACKUP_APP || !obj.data || typeof obj.data !== 'object') {
    throw new Error('not a youpage backup')
  }
  const keys = Object.keys(obj.data).filter(k => k.indexOf(PREFIX) === 0 && k !== K_SETTINGS)
  ownKeys().filter(k => k !== K_SETTINGS && keys.indexOf(k) < 0).forEach(remove)
  let pages = 0
  keys.forEach(k => {
    write(k, obj.data[k], true)
    if (k.indexOf(K_MONTH) === 0) pages += Object.keys(getMonth(k.slice(K_MONTH.length))).length
  })
  rebuildIndex()
  return pages
}

// 清空整本手帐（这台设备的设置保留）。开着云同步的话，云端和其他设备上也会清空
function clearAll() {
  ownKeys().filter(k => k !== K_SETTINGS).forEach(remove)
}

module.exports = {
  emptyDay, getMonth, getDay, saveDay, summary, stats, getMonthDeco, saveMonthDeco,
  getMonthInk, saveMonthInk,
  getHabits, saveHabits, getHabitLog, isHabitDone, toggleHabit, habitStreak,
  getSettings, setSetting, exportAll, importAll, clearAll,
  onLocalChange, isSyncable, peek, applyRemote, syncableKeys, rebuildIndex
}
