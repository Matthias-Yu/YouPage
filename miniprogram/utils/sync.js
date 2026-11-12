// 云同步：把手帐数据同步到云开发（云函数 youpageSync），换手机、删了小程序都不丢。
//
// 以 store 里的 key 为单位同步（一个月的日页、一个月的贴纸、习惯列表、一个月的打卡）。
// 每个 key 记着本地最后修改时间 ct，谁的 ct 新听谁的。
// 只有「一个月的日页」会按天合并：两台设备改了同一个月的不同天，两边都保留。
//
// 什么时候同步：小程序启动 / 回到前台时先拉后推；本地有改动后停 2.5 秒推一次；切到后台时立刻推。
// 照片：推之前先把本地照片传到云存储，日页里的照片地址换成云文件 ID。

const store = require('./store')
const member = require('./member')
const consent = require('./consent')
const config = require('../config')

const META_KEY = 'yps:meta'      // 同步状态，不以 yp: 开头，不会进备份、也不会被「清空手帐」删掉
const MONTH = /^yp:m:/
const BATCH = 20
const DEBOUNCE = 2500
const OVERLAP = 5000             // 增量拉取时往回多拉一点，防止边界上漏掉

let meta = null
let timer = null
let running = null
let again = false
let state = 'idle'               // idle | syncing | ok | error | off
let listeners = []
let started = false

function load() {
  if (!meta) {
    let m = null
    try {
      m = wx.getStorageSync(META_KEY)
    } catch (e) {}
    // reset[key]: 这个 key 在本地被整体删掉 / 换掉的时间，推上去之前，云端比它早的内容都不算数
    meta = Object.assign({ last: 0, ct: {}, dirty: {}, reset: {}, photos: {}, at: 0, err: '', adopted: false }, m || {})
  }
  return meta
}

function persist() {
  try {
    wx.setStorageSync(META_KEY, meta)
  } catch (e) {}
}

function available() {
  return typeof wx !== 'undefined' && !!wx.cloud
}

// 同步的前提：微信支持云开发、用户同意了隐私政策、这台设备没关掉同步、有这项权益
function enabled() {
  return available() && consent.get().ok && store.getSettings().sync !== false && member.canSync()
}

/* ---------- 状态 ---------- */

function status() {
  load()
  return {
    available: available(),
    on: enabled(),
    state: enabled() ? state : 'off',
    at: meta.at,
    err: meta.err,
    pending: Object.keys(meta.dirty).length
  }
}

// fn(type)：type 是 'data'（云端的改动已经写进本地）或 'status'
function subscribe(fn) {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter(f => f !== fn)
  }
}

function emit(type) {
  listeners.slice().forEach(fn => {
    try {
      fn(type)
    } catch (e) {
      console.error('[sync] listener', e)
    }
  })
}

function setState(s) {
  state = s
  emit('status')
}

/* ---------- 本地改动 ---------- */

function markDirty(key, reset) {
  load()
  const t = Date.now()
  meta.ct[key] = t
  meta.dirty[key] = 1
  if (reset) meta.reset[key] = t
  persist()
}

// 第一次开同步时，本机已有的数据要交上去；ct 记成 1，云端已经有的以云端为准（日页按天合并）
function adopt() {
  if (meta.adopted) return
  store.syncableKeys().forEach(key => {
    if (!meta.ct[key]) {
      meta.ct[key] = 1
      meta.dirty[key] = 1
    }
  })
  meta.adopted = true
  persist()
}

/* ---------- 合并 ---------- */

function parse(json) {
  if (!json) return undefined
  try {
    return JSON.parse(json)
  } catch (e) {
    return undefined
  }
}

// 两份同月的日页按天合并：每一天取 t 更新的那份（删除标记也算一份）
function mergeMonth(a, b) {
  const out = {}
  const days = Object.keys(Object.assign({}, a, b))
  days.forEach(d => {
    const x = a && a[d], y = b && b[d]
    if (!x) out[d] = y
    else if (!y) out[d] = x
    else out[d] = (y.t || 0) > (x.t || 0) ? y : x
  })
  return out
}

// 云端整条删掉了：本地只留比删除更晚的那些天
function survivorsAfter(month, t) {
  const out = {}
  for (const d in month || {}) if (month[d] && (month[d].t || 0) > t) out[d] = month[d]
  return out
}

// 收到云端的一条；返回本地数据有没有变化
function applyItem(it) {
  const key = it.key
  if (!store.isSyncable(key)) return false
  const rct = it.ct || 0
  const lct = meta.ct[key] || 0
  const remote = it.del ? undefined : parse(it.json)
  if (meta.dirty[key]) {
    if (MONTH.test(key)) {
      const local = store.peek(key)
      const since = meta.reset[key] || 0
      const merged = remote === undefined
        ? survivorsAfter(local, rct)
        : mergeMonth(local || {}, since ? survivorsAfter(remote, since) : remote)
      store.applyRemote(key, !Object.keys(merged).length && local === undefined ? undefined : merged)
      // 合并结果要比云端那份新，下一次推上去才会被接受
      meta.ct[key] = Math.max(Date.now(), rct + 1)
      return true
    }
    if (rct > lct) {
      store.applyRemote(key, remote)
      meta.ct[key] = rct
      delete meta.dirty[key]
      delete meta.reset[key]
      return true
    }
    return false
  }
  if (rct <= lct) return false
  store.applyRemote(key, remote)
  meta.ct[key] = rct
  return true
}

/* ---------- 和云函数打交道 ---------- */

function call(data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: config.SYNC_FUNCTION,
      data,
      success: res => {
        const r = res.result || {}
        if (r.ok) resolve(r)
        else reject(new Error(r.error || 'sync failed'))
      },
      fail: reject
    })
  })
}

async function pullAll() {
  let skip = 0, now = 0, changed = false
  for (let guard = 0; guard < 50; guard++) {
    const r = await call({ action: 'pull', since: meta.last, skip })
    if (!now) now = r.now
    r.items.forEach(it => {
      if (applyItem(it)) changed = true
    })
    if (!r.more) break
    skip += r.items.length
  }
  meta.last = Math.max(0, now - OVERLAP)
  return changed
}

function isLocalFile(path) {
  return typeof path === 'string' && path.length > 0 && path.indexOf('cloud://') !== 0
}

function upload(path) {
  const ext = (path.match(/\.\w+$/) || ['.jpg'])[0]
  const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + ext
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath: config.PHOTO_DIR + name,
      filePath: path,
      success: res => resolve(res.fileID),
      fail: reject
    })
  })
}

// 要推上去的日页里如果有本地照片，先传到云存储，再把地址换成云文件 ID。
// 本地路径 → 云文件 ID 记在 meta.photos 里，同一张照片不会传第二次
async function uploadPhotos() {
  const keys = Object.keys(meta.dirty).filter(k => MONTH.test(k))
  for (const key of keys) {
    const month = store.peek(key)
    if (!month) continue
    let touched = false
    const next = {}
    for (const d of Object.keys(month)) {
      const day = month[d]
      if (!day || !day.els || !day.els.some(el => el.t === 'p' && isLocalFile(el.k))) {
        next[d] = day
        continue
      }
      const els = []
      for (const el of day.els) {
        if (el.t === 'p' && isLocalFile(el.k)) {
          let id = meta.photos[el.k]
          if (!id) {
            try {
              id = await upload(el.k)
              meta.photos[el.k] = id
              persist()
            } catch (e) {
              // 文件已经不在了（比如被系统清掉的临时文件），这张照片就同步不了，保留原样
              console.warn('[sync] photo upload failed', el.k, e)
            }
          }
          els.push(id ? Object.assign({}, el, { k: id }) : el)
          if (id) touched = true
        } else els.push(el)
      }
      next[d] = Object.assign({}, day, { els })
    }
    // 换地址不算这一天被修改，不动 t；也不经过写入钩子——这个 key 本来就在待推送里
    if (touched) store.applyRemote(key, next)
  }
}

async function pushAll() {
  const keys = Object.keys(meta.dirty)
  let changed = false, rejected = 0
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH).map(key => {
      const v = store.peek(key)
      return { key, ct: meta.ct[key] || Date.now(), del: v === undefined, json: v === undefined ? '' : JSON.stringify(v) }
    })
    const sent = {}
    batch.forEach(it => {
      sent[it.key] = it.ct
    })
    const r = await call({ action: 'push', items: batch })
    r.saved.forEach(key => {
      // 推的过程中又改过的，留着下次再推
      if (meta.ct[key] === sent[key]) {
        delete meta.dirty[key]
        delete meta.reset[key]
      }
    })
    r.rejected.forEach(it => {
      if (it.error) {
        meta.err = it.error === 'too-large' ? '有一个月的内容太多，同步不了' : it.error
        delete meta.dirty[it.key]
        return
      }
      rejected++
      if (applyItem(it)) changed = true
    })
    persist()
  }
  return { changed, rejected }
}

/* ---------- 调度 ---------- */

function friendly(e) {
  const s = String((e && (e.errMsg || e.message)) || e || '')
  if (/-601034|请先开通云开发/.test(s)) return '这个小程序还没开通云开发，暂时只存在本机'
  if (/-501000|FunctionName|function not found|找不到/i.test(s)) return '云函数 youpageSync 还没部署，暂时只存在本机'
  if (/-501007|env not|environment/i.test(s)) return '云开发环境不可用，暂时只存在本机'
  if (/network|timeout|request:fail|网络/i.test(s)) return '网络不太好，稍后会自动重试'
  return '同步失败，稍后会自动重试'
}

async function run() {
  load()
  adopt()
  setState('syncing')
  meta.err = ''
  try {
    let changed = await pullAll()
    await uploadPhotos()
    const pushed = await pushAll()
    if (pushed.changed) changed = true
    meta.at = Date.now()
    if (changed) {
      store.rebuildIndex()
      emit('data')
    }
    // 推的时候被别的设备抢先了：合并好的那几份再推一次
    if (pushed.rejected) again = true
    persist()
    setState('ok')
  } catch (e) {
    console.warn('[sync] failed', e)
    meta.err = friendly(e)
    persist()
    setState('error')
  }
}

// 立刻同步一次（正在同步就排在后面）。返回 Promise
function now() {
  clearTimeout(timer)
  timer = null
  if (!enabled()) {
    emit('status')
    return Promise.resolve()
  }
  if (running) {
    again = true
    return running
  }
  running = run().then(() => {
    running = null
    if (again) {
      again = false
      schedule(800)
    }
  })
  return running
}

function schedule(ms) {
  if (!enabled()) return
  clearTimeout(timer)
  timer = setTimeout(now, ms === undefined ? DEBOUNCE : ms)
}

// 小程序启动时调用一次：挂上 store 的写入钩子
function start() {
  if (started) return
  started = true
  load()
  store.onLocalChange((key, reset) => {
    markDirty(key, reset)
    schedule()
  })
}

// 回到前台：稍等片刻再同步（启动时 onLaunch / onShow 会连着来，合并成一次）
function kick() {
  schedule(400)
}

// 切到后台：有没推的就马上推
function flush() {
  load()
  if (Object.keys(meta.dirty).length) now()
}

// 打开 / 关闭这台设备的同步
function setEnabled(on) {
  store.setSetting('sync', !!on)
  emit('status')
  if (on) now()
}

/* ---------- 删除云端数据 ---------- */

const MONTH_KEY = /^yp:m:/

function fileExists(path) {
  try {
    wx.getFileSystemManager().accessSync(path)
    return true
  } catch (e) {
    return false
  }
}

function download(fileID) {
  return new Promise((resolve, reject) => {
    wx.cloud.downloadFile({
      fileID,
      success: res => {
        const ext = (fileID.match(/\.\w+$/) || ['.jpg'])[0]
        const dest = wx.env.USER_DATA_PATH + '/photo_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + ext
        wx.getFileSystemManager().saveFile({
          tempFilePath: res.tempFilePath,
          filePath: dest,
          success: r => resolve(r.savedFilePath || dest),
          fail: reject
        })
      },
      fail: reject
    })
  })
}

// 删除云端之前，把日页里引用的云端照片都换回本机文件：本机还留着原图就直接用，没有就先下载下来。
// 有任何一张没拿到就抛错，不继续删
async function localizePhotos() {
  const back = {}
  Object.keys(meta.photos).forEach(local => {
    back[meta.photos[local]] = local
  })
  for (const key of store.syncableKeys().filter(k => MONTH_KEY.test(k))) {
    const month = store.peek(key)
    if (!month) continue
    let touched = false
    const next = {}
    for (const d of Object.keys(month)) {
      const day = month[d]
      if (!day || !day.els) {
        next[d] = day
        continue
      }
      const els = []
      for (const el of day.els) {
        if (el.t === 'p' && typeof el.k === 'string' && el.k.indexOf('cloud://') === 0) {
          let local = back[el.k]
          if (!local || !fileExists(local)) local = await download(el.k)
          els.push(Object.assign({}, el, { k: local }))
          touched = true
        } else els.push(el)
      }
      next[d] = Object.assign({}, day, { els })
    }
    if (touched) store.applyRemote(key, next)
  }
}

function deleteFiles(ids) {
  const list = ids.filter((id, i) => id && ids.indexOf(id) === i)
  const jobs = []
  for (let i = 0; i < list.length; i += 50) {
    jobs.push(new Promise(resolve => {
      wx.cloud.deleteFile({ fileList: list.slice(i, i + 50), complete: resolve })
    }))
  }
  return Promise.all(jobs)
}

// 删除这个用户在云端的全部手帐和照片。这台手机上的内容保留，并关闭这台设备的同步。
// 照片文件由客户端用用户自己的权限删除（云函数不替客户端删文件，免得被拿来删别人的文件）
async function wipeCloud() {
  load()
  clearTimeout(timer)
  timer = null
  if (running) await running
  await localizePhotos()
  const r = await call({ action: 'wipe' })
  await deleteFiles((r.files || []).concat(Object.keys(meta.photos).map(k => meta.photos[k])))
  store.setSetting('sync', false)
  meta = null
  try {
    wx.removeStorageSync(META_KEY)
  } catch (e) {}
  load()
  emit('status')
  return r
}

module.exports = { start, kick, flush, now, schedule, status, subscribe, setEnabled, wipeCloud, mergeMonth }
