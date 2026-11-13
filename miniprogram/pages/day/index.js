// 日页：一天一页。待办 + 随手记是「印」在纸上的，贴纸 / 胶带 / 照片可以随手贴在任何位置。
const store = require('../../utils/store')
const date = require('../../utils/date')
const catalog = require('../../utils/catalog')
const member = require('../../utils/member')

let seq = 0
function newId(prefix) {
  return prefix + Date.now().toString(36) + (seq++).toString(36)
}

function rand(lo, hi) {
  return Math.round((lo + Math.random() * (hi - lo)) * 10) / 10
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

Page({
  data: {
    key: '',
    d: 0,
    monthEn: '',
    wd: '',
    lunarText: '',
    fest: '',
    isToday: false,

    plan: '',
    mood: '',
    weather: '',
    moodSrc: '',
    weatherSrc: '',
    todos: [],
    doneN: 0,
    draft: '',
    note: '',
    els: [],
    pw: 0,

    sheet: '', // '' | 'mood' | 'weather' | 'sticker' | 'tape'
    moods: catalog.MOODS,
    weathers: catalog.WEATHERS,
    tapes: catalog.TAPES,
    packs: [],
    packIdx: 0,
    packItems: [],
    beta: member.BETA_FREE
  },

  onLoad(query) {
    this.cropOnReady = query.photo === '1'
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.winH = info.windowHeight
    // 纸页左右各留 24rpx
    this.margin = info.windowWidth * 24 / 750
    this.setData({
      pw: Math.round(info.windowWidth - this.margin * 2),
      packs: catalog.PACKS.map(p => ({ id: p.id, name: p.name, vip: p.vip })),
      packItems: this.packItems(0)
    })
    this.load(query.date || date.today().key)
  },

  onReady() {
    if (this.cropOnReady) this.pickPhoto()
  },

  onShow() {
    const photo = this.pendingPhoto
    if (!photo) return
    this.pendingPhoto = null
    this.addEl('p', photo.path, photo.ratio)
  },

  onHide() {
    this.flush()
  },

  onUnload() {
    this.flush()
  },

  packItems(i) {
    return catalog.PACKS[i].keys.map(k => ({ k, src: catalog.src(k), wide: catalog.isWide(k) }))
  },

  load(key) {
    const p = date.parse(key)
    const day = store.getDay(key)
    const lu = date.lunar(p.y, p.m, p.d)
    this.note = day.note
    this.dirty = false
    this.setData({
      key,
      d: p.d,
      monthEn: date.MONTH_EN[p.m - 1],
      wd: date.WEEK_CN[date.weekday(p.y, p.m, p.d)],
      lunarText: date.lunarText(lu),
      fest: date.festival(p.y, p.m, p.d, lu),
      isToday: key === date.today().key,
      plan: day.plan,
      mood: day.mood,
      weather: day.weather,
      moodSrc: catalog.moodSrc(day.mood),
      weatherSrc: catalog.weatherSrc(day.weather),
      todos: day.todos,
      doneN: day.todos.filter(t => t.done).length,
      draft: '',
      note: day.note,
      els: day.els,
      sheet: ''
    })
    wx.setNavigationBarTitle({ title: p.y + '年' + p.m + '月' + p.d + '日' })
    const deco = this.selectComponent('#deco')
    if (deco) deco.clear()
  },

  /* ---------- 保存 ---------- */

  save() {
    this.dirty = true
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 600)
  },

  flush() {
    clearTimeout(this.timer)
    if (!this.dirty) return
    this.dirty = false
    const { key, plan, mood, weather, todos, els } = this.data
    store.saveDay(key, { plan, mood, weather, todos, note: this.note || '', els })
  },

  // 月历格子里的那一句
  onPlan(e) {
    this.setData({ plan: e.detail.value })
    this.save()
  },

  /* ---------- 翻页 ---------- */

  shift(e) {
    this.flush()
    this.load(date.addDays(this.data.key, +e.currentTarget.dataset.n))
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },

  /* ---------- 心情 / 天气 ---------- */

  openSheet(e) {
    const deco = this.selectComponent('#deco')
    if (deco) deco.clear()
    this.setData({ sheet: e.currentTarget.dataset.sheet })
  },

  closeSheet() {
    this.setData({ sheet: '' })
  },

  pickStamp(e) {
    const kind = this.data.sheet
    const id = e.currentTarget.dataset.id
    // 再点一次已选中的 = 取消
    const next = this.data[kind] === id ? '' : id
    const patch = { sheet: '' }
    patch[kind] = next
    patch[kind + 'Src'] = kind === 'mood' ? catalog.moodSrc(next) : catalog.weatherSrc(next)
    this.setData(patch)
    this.save()
  },

  /* ---------- 待办 ---------- */

  setTodos(todos) {
    this.setData({ todos, doneN: todos.filter(t => t.done).length })
    this.save()
  },

  onDraft(e) {
    this.setData({ draft: e.detail.value })
  },

  addTodo(e) {
    const text = (e.detail.value || '').trim()
    if (!text) {
      if (this.data.draft) this.setData({ draft: '' })
      return
    }
    // 回车和失焦可能先后触发，同一条内容只加一次
    const now = Date.now()
    if (this.lastAdd && this.lastAdd.text === text && now - this.lastAdd.at < 800) return
    this.lastAdd = { text, at: now }
    this.setData({ draft: '' })
    this.setTodos(this.data.todos.concat({ id: newId('t'), text, done: false }))
  },

  editTodo(e) {
    const id = e.currentTarget.dataset.id
    const text = (e.detail.value || '').trim()
    const old = this.data.todos.find(t => t.id === id)
    if (!old || old.text === text) return
    // 清空文字 = 删除这条
    if (!text) this.setTodos(this.data.todos.filter(t => t.id !== id))
    else this.setTodos(this.data.todos.map(t => (t.id === id ? Object.assign({}, t, { text }) : t)))
  },

  toggleTodo(e) {
    const id = e.currentTarget.dataset.id
    this.setTodos(this.data.todos.map(t => (t.id === id ? Object.assign({}, t, { done: !t.done }) : t)))
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
  },

  /* ---------- 随手记 ---------- */

  onNote(e) {
    // 不 setData，避免输入时光标跳动；保存时从 this.note 取
    this.note = e.detail.value
    this.save()
  },

  /* ---------- 贴纸 / 胶带 / 照片 ---------- */

  switchPack(e) {
    const i = e.currentTarget.dataset.i
    this.setData({ packIdx: i, packItems: this.packItems(i) })
  },

  pickSticker(e) {
    const pack = catalog.PACKS[this.data.packIdx]
    if (!member.canUsePack(pack)) {
      this.setData({ sheet: '' })
      wx.navigateTo({ url: '/pages/member/index' })
      return
    }
    this.addEl('s', e.currentTarget.dataset.k)
  },

  pickTape(e) {
    this.addEl('t', e.currentTarget.dataset.id)
  },

  pickPhoto() {
    if (this.pickingPhoto) return
    this.pickingPhoto = true
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: res => {
        const photo = res.tempFiles && res.tempFiles[0]
        if (!photo) return
        wx.navigateTo({
          url: '/pages/photo-crop/index?src=' + encodeURIComponent(photo.tempFilePath),
          events: { photo: result => { this.pendingPhoto = result } },
          fail: () => wx.showToast({ title: '打不开照片裁切工具', icon: 'none' })
        })
      },
      complete: () => { this.pickingPhoto = false }
    })
  },

  // 新元素落在当前屏幕中间偏上的位置，带一点随机的歪斜
  addEl(t, k, ratio) {
    wx.createSelectorQuery().selectViewport().scrollOffset(res => {
      const scrollTop = res ? res.scrollTop : 0
      const pw = this.data.pw
      const y = (scrollTop + this.winH * 0.34 - this.margin) / pw
      const tilt = t === 's' ? rand(-8, 8) : rand(-4, 4)
      const el = {
        id: newId('e'),
        t,
        k,
        x: clamp(0.5 + rand(-0.08, 0.08), 0.15, 0.85),
        y: Math.max(0.14, Math.round((y + rand(-0.05, 0.05)) * 1000) / 1000),
        s: 1,
        r: tilt
      }
      if (ratio) el.ratio = ratio
      this.setData({ els: this.data.els.concat(el), sheet: '' }, () => {
        const deco = this.selectComponent('#deco')
        if (deco) deco.select(el.id)
      })
      this.save()
    }).exec()
  },

  onEls(e) {
    const { items, removed } = e.detail
    this.setData({ els: items })
    this.save()
    if (removed && removed.t === 'p') {
      if (removed.k.indexOf(wx.env.USER_DATA_PATH) === 0) {
        wx.getFileSystemManager().unlink({ filePath: removed.k, fail() {} })
      } else if (removed.k.indexOf('cloud://') === 0 && wx.cloud) {
        // 已经同步到云存储的照片，云端那份也删掉
        wx.cloud.deleteFile({ fileList: [removed.k], fail() {} })
      }
    }
  },

  // 点纸页空白处取消选中
  onBlank() {
    const deco = this.selectComponent('#deco')
    if (deco) deco.clear()
  },

  noop() {}
})
