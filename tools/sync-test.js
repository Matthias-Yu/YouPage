// 云同步的双设备测试：真实的云函数代码（cloudfunctions/youpageSync）跑在一个内存数据库上，
// 两三台「设备」各自加载一份小程序的 store / sync 模块，轮流改数据、同步，检查最后是否一致。
// 用法（本机没有 Node 时用开发者工具自带的运行时）：
//   $env:ELECTRON_RUN_AS_NODE='1'; & "<微信开发者工具.exe>" tools\sync-test.js
const path = require('path')
const Module = require('module')

const ROOT = path.join(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
let fail = 0
const ok = (cond, msg) => {
  if (!cond) fail++
  console.log((cond ? '  ok   ' : '  FAIL ') + msg)
}
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

// 同步模块里的防抖定时器在测试里一律不跑，全部手动调用 sync.now()
global.setTimeout = () => 0
global.clearTimeout = () => {}

/* ---------- 假的 wx-server-sdk：一个内存数据库 ---------- */
const DB = {}
let OPENID = 'user-1'
const sdk = {
  DYNAMIC_CURRENT_ENV: 'test-env',
  init() {},
  getWXContext: () => ({ OPENID }),
  database() {
    const match = (doc, where) => Object.keys(where).every(k => {
      const c = where[k]
      if (c && typeof c === 'object' && '$gt' in c) return doc[k] > c.$gt
      if (c && typeof c === 'object' && '$in' in c) return c.$in.indexOf(doc[k]) > -1
      return doc[k] === c
    })
    return {
      command: { gt: v => ({ $gt: v }), in: v => ({ $in: v }) },
      async createCollection(name) {
        DB[name] = DB[name] || {}
      },
      collection(name) {
        const need = () => {
          if (!DB[name]) {
            const e = new Error('collection not exist')
            e.errCode = -502005
            throw e
          }
          return DB[name]
        }
        const q = { where: {}, skip: 0, limit: 100, order: null }
        const api = {
          where(w) { q.where = w; return api },
          orderBy(f, d) { q.order = [f, d === 'desc' ? -1 : 1]; return api },
          skip(n) { q.skip = n; return api },
          limit(n) { q.limit = n; return api },
          async get() {
            let rows = Object.values(need()).filter(d => match(d, q.where))
            if (q.order) rows.sort((a, b) => (a[q.order[0]] - b[q.order[0]]) * q.order[1])
            return { data: clone(rows.slice(q.skip, q.skip + q.limit)) }
          },
          async remove() {
            const col = need()
            const ids = Object.keys(col).filter(id => match(col[id], q.where))
            ids.forEach(id => delete col[id])
            return { stats: { removed: ids.length } }
          },
          doc(id) {
            return {
              async set({ data }) {
                need()[id] = Object.assign({ _id: id }, clone(data))
                return {}
              }
            }
          }
        }
        return api
      }
    }
  }
}
const load = Module._load
Module._load = function (req) {
  if (req === 'wx-server-sdk') return sdk
  return load.apply(this, arguments)
}
const fn = require(path.join(ROOT, 'cloudfunctions', 'youpageSync', 'index.js'))

// 云函数的 st 用的是服务器时间；测试跑得太快，同一毫秒里会写好几条，这里让时间每次至少走 1ms
let clock = Date.now()
const realNow = Date.now
Date.now = () => (clock = Math.max(clock + 1, realNow()))

/* ---------- 设备 ---------- */
function device(name, preset) {
  const mem = {}
  Object.keys(preset || {}).forEach(k => {
    if (k.indexOf('yp') === 0) mem[k] = JSON.stringify(preset[k])
  })
  const uploads = []
  const deleted = []
  const files = {}  // 这台设备上存在的本地文件
  let seq = 0
  const wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getFileSystemManager: () => ({
      accessSync(p) {
        if (!files[p]) throw new Error('no such file ' + p)
      },
      saveFile({ filePath, success }) {
        files[filePath] = 1
        success({ savedFilePath: filePath })
      }
    }),
    getStorageSync: k => (k in mem ? JSON.parse(mem[k]) : ''),
    setStorageSync: (k, v) => { mem[k] = JSON.stringify(v) },
    removeStorageSync: k => { delete mem[k] },
    getStorageInfoSync: () => ({ keys: Object.keys(mem) }),
    showToast() {},
    cloud: {
      callFunction({ data, success, fail: onFail }) {
        fn.main(clone(data)).then(result => success({ result }), onFail)
      },
      uploadFile({ cloudPath, filePath, success }) {
        uploads.push(filePath)
        success({ fileID: 'cloud://test-env/' + cloudPath })
      },
      downloadFile({ fileID, success }) {
        success({ tempFilePath: 'http://tmp/dl' + (seq++) })
      },
      deleteFile({ fileList, complete }) {
        deleted.push.apply(deleted, fileList)
        if (complete) complete()
      }
    }
  }
  // 每台设备一套全新的模块实例
  Object.keys(require.cache).forEach(k => {
    if (k.indexOf(MP) === 0) delete require.cache[k]
  })
  global.wx = wx
  const store = require(path.join(MP, 'utils', 'store.js'))
  const sync = require(path.join(MP, 'utils', 'sync.js'))
  const consent = require(path.join(MP, 'utils', 'consent.js'))
  if (!(preset && preset.noConsent)) consent.set(true)
  sync.start()
  const dev = { name, mem, wx, store, sync, consent, uploads, deleted, files }
  // 在这台设备上做事：切换全局 wx
  dev.do = async f => {
    global.wx = wx
    return f(store, sync)
  }
  dev.syncNow = () => dev.do((s, y) => y.now())
  return dev
}

const day = (plan, extra) => Object.assign({ plan, mood: '', weather: '', todos: [], note: '', els: [] }, extra)

;(async () => {
  console.log('== first device uploads, second device downloads')
  const A = device('A')
  await A.do(s => {
    s.saveDay('2026-11-12', day('看牙医'))
    s.saveHabits([{ id: 'h1', name: '喝水', icon: 'coffee' }])
    s.toggleHabit('h1', '2026-11-12')
    s.saveMonthDeco('2026-11', [{ id: 's1', t: 's', k: 'star', x: 0.5, y: 0.5, s: 1, r: 0 }])
  })
  await A.syncNow()
  ok(A.sync.status().state === 'ok' && A.sync.status().pending === 0, 'A synced, nothing pending')
  ok(Object.keys(DB.youpage_kv || {}).length === 4, 'cloud has 4 records (collection auto-created)')

  const B = device('B')
  await B.syncNow()
  await B.do(s => {
    ok(s.getDay('2026-11-12').plan === '看牙医', 'B got the day')
    ok(s.getHabits()[0].name === '喝水' && s.isHabitDone('h1', '2026-11-12'), 'B got habits and check-ins')
    ok(s.getMonthDeco('2026-11').length === 1, 'B got month stickers')
    ok(s.stats().pages === 1, 'B index rebuilt (stats count the page)')
  })

  console.log('== both edit different days of the same month')
  await A.do(s => s.saveDay('2026-11-13', day('A 写的')))
  await B.do(s => s.saveDay('2026-11-14', day('B 写的')))
  await A.syncNow()
  await B.syncNow()
  await A.syncNow()
  for (const D of [A, B]) {
    await D.do(s => {
      const m = s.getMonth('2026-11')
      ok(m[12] && m[13] && m[14] && m[13].plan === 'A 写的' && m[14].plan === 'B 写的', D.name + ' has days 12, 13, 14')
    })
  }

  console.log('== same day edited on both: the later edit wins')
  await A.do(s => s.saveDay('2026-11-13', day('A 改的')))
  await B.do(s => s.saveDay('2026-11-13', day('B 后改的')))
  await A.syncNow()
  await B.syncNow()
  await A.syncNow()
  for (const D of [A, B]) await D.do(s => ok(s.getDay('2026-11-13').plan === 'B 后改的', D.name + ' day 13 = B 后改的'))

  console.log('== deleting a day propagates')
  await B.do(s => s.saveDay('2026-11-12', day('')))
  await B.syncNow()
  await A.syncNow()
  await A.do(s => ok(!s.getMonth('2026-11')[12] && s.getMonth('2026-11')[13], 'A no longer has day 12, still has 13'))

  console.log('== non-month data: last writer wins')
  await A.do(s => s.saveHabits([{ id: 'h1', name: 'A 的名字', icon: 'coffee' }]))
  await B.do(s => s.saveHabits([{ id: 'h1', name: 'B 的名字', icon: 'coffee' }]))
  await A.syncNow()
  await B.syncNow()
  await A.syncNow()
  for (const D of [A, B]) await D.do(s => ok(s.getHabits()[0].name === 'B 的名字', D.name + ' habits = B 的名字'))

  console.log('== photos are uploaded once and replaced by cloud file IDs')
  const photo = { id: 'p1', t: 'p', k: 'wxfile://usr/photo_1.jpg', x: 0.5, y: 0.5, s: 1, r: 0 }
  await A.do(s => s.saveDay('2026-11-20', day('', { els: [photo] })))
  await A.syncNow()
  await A.do(s => ok(s.getDay('2026-11-20').els[0].k.indexOf('cloud://') === 0, 'A now references the cloud file'))
  // 日页还开着、又把本地路径写回去：不应该再传一次
  await A.do(s => s.saveDay('2026-11-20', day('又写了一句', { els: [photo] })))
  await A.syncNow()
  ok(A.uploads.length === 1, 'the same photo was uploaded once (' + A.uploads.length + ')')
  await B.syncNow()
  await B.do(s => {
    const d = s.getDay('2026-11-20')
    ok(d.plan === '又写了一句' && d.els[0].k.indexOf('cloud://') === 0, 'B sees the photo as a cloud file')
  })

  console.log('== restoring a backup rewrites the cloud')
  const backup = await B.do(s => clone(s.exportAll()))
  await A.do(s => s.saveDay('2026-12-01', day('备份之后才写的')))
  await A.syncNow()
  await A.do(s => s.importAll(backup))
  await A.syncNow()
  await B.syncNow()
  for (const D of [A, B]) {
    await D.do(s => ok(Object.keys(s.getMonth('2026-12')).length === 0 && s.getDay('2026-11-13').plan === 'B 后改的', D.name + ' matches the backup'))
  }

  console.log('== clearing the journal clears every device, settings stay')
  await A.do(s => s.setSetting('weekStart', 0))
  await A.do(s => s.clearAll())
  await A.syncNow()
  await B.syncNow()
  await A.do(s => ok(s.stats().pages === 0 && s.getSettings().weekStart === 0, 'A empty, its settings kept'))
  await B.do(s => ok(s.stats().pages === 0 && s.getHabits().length === 0 && s.getMonthDeco('2026-11').length === 0, 'B empty too'))

  console.log('== a phone that already had data before turning sync on')
  await A.do(s => s.saveDay('2026-10-01', day('云端已有')))
  await A.syncNow()
  const C = device('C', { 'yp:m:2026-10': { 2: day('C 本地的', { t: 5 }) }, 'yp:index': ['2026-10'] })
  await C.syncNow()
  await C.do(s => {
    const m = s.getMonth('2026-10')
    ok(m[1] && m[2] && m[2].plan === 'C 本地的', 'C keeps its own day and gets the cloud day')
  })
  await A.syncNow()
  await A.do(s => ok(s.getDay('2026-10-02').plan === 'C 本地的', 'A receives C\'s old local day'))

  console.log('== sync switched off on a device')
  await B.do(s => s.setSetting('sync', false))
  await B.do(s => s.saveDay('2026-10-05', day('只在 B 上')))
  await B.syncNow()
  ok(B.sync.status().state === 'off', 'B reports off')
  await A.syncNow()
  await A.do(s => ok(!s.getMonth('2026-10')[5], 'A did not receive it'))
  await B.do((s, y) => y.setEnabled(true))
  await B.syncNow()
  await A.syncNow()
  await A.do(s => ok(s.getDay('2026-10-05').plan === '只在 B 上', 'after turning it back on, A receives it'))

  console.log('== nothing is uploaded before the privacy policy is accepted')
  const D = device('D', { noConsent: true })
  await D.do(s => s.saveDay('2026-09-01', day('还没同意')))
  await D.syncNow()
  ok(D.sync.status().state === 'off' && !Object.values(DB.youpage_kv).some(r => r.key === 'yp:m:2026-09'), 'D stays local')
  await D.do((s, y) => {
    D.consent.set(true)
    return y.now()
  })
  ok(Object.values(DB.youpage_kv).some(r => r.key === 'yp:m:2026-09'), 'after agreeing, D uploads')

  console.log('== deleting all cloud data')
  await A.do(s => s.saveDay('2026-10-15', day('', { els: [{ id: 'p2', t: 'p', k: 'wxfile://usr/p2.jpg', x: 0.5, y: 0.5, s: 1, r: 0 }] })))
  A.files['wxfile://usr/p2.jpg'] = 1
  await A.syncNow()
  await B.syncNow()
  const photoId = await B.do(s => s.getDay('2026-10-15').els[0].k)
  ok(photoId.indexOf('cloud://') === 0, 'B has the photo as a cloud file')
  const res = await B.do((s, y) => y.wipeCloud())
  ok(res.ok && res.removed > 0 && !Object.values(DB.youpage_kv).some(r => r.owner === 'user-1'), 'all of this user\'s records are gone (' + res.removed + ')')
  ok(B.deleted.indexOf(photoId) > -1, 'the photo file was deleted by the client')
  await B.do(s => {
    const k = s.getDay('2026-10-15').els[0].k
    ok(k.indexOf('wxfile://usr/photo_') === 0, 'B kept its own copy of the photo (' + k + ')')
    ok(s.getDay('2026-10-02').plan === 'C 本地的', 'B keeps its local journal')
  })
  ok(B.sync.status().state === 'off', 'B turned sync off')
  await A.do(s => {
    const k = s.getDay('2026-10-15').els[0].k
    ok(k.indexOf('cloud://') === 0, 'A is untouched until it changes something')
  })

  console.log('== cloud function guards')
  ok((await fn.main({ action: 'push', items: [{ key: 'yp:settings', json: '{}', ct: 1 }] })).saved.length === 0, 'non-journal keys are ignored')
  OPENID = ''
  ok((await fn.main({ action: 'pull' })).ok === false, 'calls without an openid are refused')
  OPENID = 'user-2'
  ok((await fn.main({ action: 'pull', since: 0 })).items.length === 0, 'another user sees nothing')

  console.log(fail ? '\n' + fail + ' FAILED' : '\nALL OK')
  process.exit(fail ? 1 : 0)
})().catch(e => {
  console.error(e)
  process.exit(1)
})
