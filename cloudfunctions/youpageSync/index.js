// 有页 · 手帐云同步
//
// 每个用户的每一份本地数据（一个月的日页、一个月的贴纸、习惯列表、一个月的打卡）存成一条记录：
//   { _id, owner, key, json, del, ct, st }
//   owner  用户 openid（由云函数从调用上下文里取，客户端无法伪造）
//   key    本地存储的 key，例如 yp:m:2026-11
//   json   值的 JSON 字符串；del 为 true 时是删除标记
//   ct     客户端修改时间（毫秒），用来判断谁更新
//   st     服务器写入时间（毫秒），用来做增量拉取
//
// action:
//   pull { since, skip }  拉取 st > since 的记录，一次最多 PAGE_OUT 条，more 表示还有
//   push { items: [{ key, json, del, ct }] }
//          逐条写入；如果云端那条的 ct 更新，就不写，把云端的版本放进 rejected 返回
//   wipe   删除这个用户的全部记录，返回记录里引用到的照片文件 ID，由客户端用自己的权限去删文件

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const COL = 'youpage_kv'
const PAGE = 100            // 单次查询条数
const PAGE_OUT = 300        // 单次 pull 最多返回多少条
const MAX_PUSH = 20         // 单次 push 最多多少条
const MAX_JSON = 900 * 1024 // 单条数据上限（字符数）
const KEY_RE = /^yp:(m|d|i|h):\d{4}-\d{2}$|^yp:habits$/

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'no-openid' }
  const run = () => {
    if (event.action === 'pull') return pull(OPENID, Number(event.since) || 0, Number(event.skip) || 0)
    if (event.action === 'push') return push(OPENID, event.items)
    if (event.action === 'wipe') return wipe(OPENID)
    return Promise.resolve({ ok: false, error: 'bad-action' })
  }
  try {
    return await run()
  } catch (e) {
    // 第一次用：集合还不存在，建好再来一次
    if (missingCollection(e)) {
      try {
        await db.createCollection(COL)
      } catch (e2) {}
      return run()
    }
    console.error('[youpageSync]', e)
    return { ok: false, error: String((e && e.message) || e) }
  }
}

function missingCollection(e) {
  const s = String((e && (e.errCode || '')) + ' ' + ((e && e.message) || ''))
  return /-502005|not exist|COLLECTION_NOT_EXIST/i.test(s)
}

function docId(owner, key) {
  return owner + '_' + key.replace(/[^\w-]/g, '_')
}

async function pull(owner, since, skip) {
  const now = Date.now()
  const items = []
  let more = false
  for (let at = skip; ; at += PAGE) {
    const res = await db.collection(COL)
      .where({ owner, st: _.gt(since) })
      .orderBy('st', 'asc')
      .skip(at)
      .limit(PAGE)
      .get()
    res.data.forEach(d => items.push({ key: d.key, json: d.del ? '' : d.json, ct: d.ct, del: !!d.del }))
    if (res.data.length < PAGE) break
    if (items.length >= PAGE_OUT) {
      more = true
      break
    }
  }
  return { ok: true, now, items, more }
}

async function wipe(owner) {
  const files = new Set()
  let removed = 0
  for (let round = 0; round < 200; round++) {
    const res = await db.collection(COL).where({ owner }).limit(PAGE).get()
    if (!res.data.length) break
    res.data.forEach(d => {
      String(d.json || '').replace(/cloud:\/\/[^"\\\s]+/g, id => {
        files.add(id)
        return id
      })
    })
    await db.collection(COL).where({ owner, _id: _.in(res.data.map(d => d._id)) }).remove()
    removed += res.data.length
    if (res.data.length < PAGE) break
  }
  return { ok: true, removed, files: Array.from(files) }
}

async function push(owner, items) {
  if (!Array.isArray(items) || items.length > MAX_PUSH) return { ok: false, error: 'bad-items' }
  const saved = [], rejected = []
  for (const it of items) {
    if (!it || typeof it.key !== 'string' || !KEY_RE.test(it.key) || typeof it.ct !== 'number') continue
    const json = it.del ? '' : String(it.json || '')
    if (json.length > MAX_JSON) {
      rejected.push({ key: it.key, error: 'too-large' })
      continue
    }
    const id = docId(owner, it.key)
    const found = await db.collection(COL).where({ _id: id }).get()
    const cur = found.data[0]
    if (cur && cur.ct > it.ct) {
      rejected.push({ key: it.key, json: cur.del ? '' : cur.json, ct: cur.ct, del: !!cur.del })
      continue
    }
    await db.collection(COL).doc(id).set({
      data: { owner, key: it.key, json, del: !!it.del, ct: it.ct, st: Date.now() }
    })
    saved.push(it.key)
  }
  return { ok: true, saved, rejected }
}
