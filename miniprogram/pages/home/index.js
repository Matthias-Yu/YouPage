// 首页：一本放在桌面上的 3D 活页手帐（场景在 scene/planner.js）。
// 这里只管画布之外的界面：顶部提示、底部按钮和贴纸条、写字时的输入栏。
// 界面都摆在画布外面、不叠在画布上——WebGL 画布在开发者工具里会盖住普通组件。
const store = require('../../utils/store')
const date = require('../../utils/date')
const catalog = require('../../utils/catalog')
const member = require('../../utils/member')
const sound = require('../../utils/sound')
const sync = require('../../utils/sync')
const consent = require('../../utils/consent')
const { Planner } = require('../../scene/planner')

const TAPE_PACK = { id: 'tape', name: '胶带', vip: false }
const DOCK_H = 118  // 翻月栏和底部菜单
const TRAY_H = 164  // 贴纸夹（含翻页）
const STICKERS_PER_PAGE = 12
const CONSENT_H = 218 // 第一次打开时的同意卡片
const INK_H = 54     // 写字时输入栏的高度
const LIFT = 44      // 拖贴纸时，贴纸悬在手指上方多少 px

Page({
  data: {
    navTop: 28,
    topH: 72,
    glH: 500,
    panelH: DOCK_H,
    safeBottom: 0,
    ready: false,
    open: false,
    y: 0,
    m: 0,
    isThisMonth: true,
    tray: false,
    packs: catalog.PACKS.map(p => ({ id: p.id, name: p.name, vip: p.vip })).concat(TAPE_PACK),
    packIdx: 0,
    trayPage: 0,
    trayPages: 1,
    items: [],
    ink: null,
    kb: 0,
    consentAsk: false
  },

  onLoad() {
    const t = date.today()
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    let navTop = (info.statusBarHeight || 20) + 6
    try {
      const menu = wx.getMenuButtonBoundingClientRect()
      if (menu && menu.top) navTop = menu.top
    } catch (e) {}
    this.winW = info.windowWidth
    this.winH = info.windowHeight
    this.dpr = info.pixelRatio
    const safeBottom = info.safeArea ? Math.max(0, info.screenHeight - info.safeArea.bottom) : 0
    const topH = navTop + 42
    // 还没对这一版隐私政策做过选择：底部先放同意卡片
    const consentAsk = !consent.get().decided
    this.consentH = CONSENT_H + (this.winW < 350 ? 22 : 0)
    const panelH = (consentAsk ? this.consentH : DOCK_H) + safeBottom
    this.setData({
      navTop, topH, safeBottom, consentAsk, panelH,
      glH: this.winH - topH - panelH,
      y: t.y, m: t.m,
      ...this.packPage(0, 0)
    })
    // 云端有新内容拉下来了：重画纸页
    this.offSync = sync.subscribe(type => {
      if (type === 'data' && this.planner) this.planner.refresh()
    })
  },

  onReady() {
    wx.createSelectorQuery().select('#gl').fields({ node: true, size: true }).exec(res => {
      const r = res && res[0]
      if (!r || !r.node) {
        wx.showModal({ title: '打不开 3D 手帐', content: '当前微信版本不支持 WebGL 画布，请升级微信后再试。', showCancel: false })
        return
      }
      const startOpen = !store.getSettings().cover
      try {
        this.planner = new Planner(r.node, {
          width: this.winW,
          height: this.data.glH,
          dpr: this.dpr,
          y: this.data.y,
          m: this.data.m,
          year: date.today().y,
          open: startOpen,
          on: (type, payload) => this.onPlanner(type, payload)
        })
      } catch (e) {
        console.error('[home] planner init failed', e)
        wx.showModal({ title: '打不开 3D 手帐', content: String((e && e.message) || e), showCancel: false })
        return
      }
      this.setData({ ready: true, open: startOpen })
    })
  },

  onShow() {
    if (!this.planner) return
    this.planner.resume()
    // 从日页、打卡、设置回来，数据可能变了
    this.planner.refresh()
  },

  onHide() {
    if (this.planner) this.planner.pause()
  },

  onUnload() {
    if (this.offSync) this.offSync()
    if (this.planner) this.planner.dispose()
  },

  onShareAppMessage() {
    return { title: '有页｜每天，有一页', path: '/pages/home/index' }
  },

  // 底部占多高，画布就让出多高
  layout(patch) {
    const d = Object.assign({}, this.data, patch)
    const panelH = (d.consentAsk ? this.consentH : DOCK_H + (d.tray ? TRAY_H : 0)) + d.safeBottom
    const bottom = d.ink ? INK_H + (d.kb || d.safeBottom) : panelH
    const glH = Math.max(160, this.winH - d.topH - bottom)
    this.setData(Object.assign({ panelH, glH }, patch))
    if (this.planner) this.planner.resize(this.winW, glH)
  },

  onPlanner(type, p) {
    if (type === 'open') {
      if (!p && this.data.tray) this.layout({ open: false, tray: false })
      else this.setData({ open: p })
    } else if (type === 'month') this.setData({ y: p.y, m: p.m, isThisMonth: this.isThisMonth(p.y, p.m) })
    else if (type === 'tab') this.planner.setMonth(this.data.y, p)
    else if (type === 'cell') this.startInk(p)
    else if (type === 'toast') wx.showToast({ title: p, icon: 'none', duration: 900 })
  },

  isThisMonth(y, m) {
    const t = date.today()
    return y === t.y && m === t.m
  },

  /* ---------- 手势：转成画布内坐标交给场景 ---------- */

  pts(list) {
    const top = this.data.topH
    return list.map(t => ({
      id: t.identifier,
      x: t.x !== undefined ? t.x : t.clientX,
      y: t.y !== undefined ? t.y : t.clientY - top
    }))
  },

  onTouchStart(e) {
    if (this.planner) this.planner.touchStart(this.pts(e.touches))
  },

  onTouchMove(e) {
    if (this.planner) this.planner.touchMove(this.pts(e.touches))
  },

  onTouchEnd(e) {
    if (this.planner) this.planner.touchEnd(this.pts(e.touches))
  },

  /* ---------- 底部按钮 ---------- */

  toggleOpen() {
    if (this.planner) this.planner.setOpen(!this.data.open)
  },

  openBook() {
    if (this.planner) this.planner.setOpen(true)
  },

  showBook() {
    if (this.data.tray) this.layout({ tray: false })
    this.openBook()
  },

  shift(n) {
    if (!this.planner) return
    if (!this.data.open) this.planner.setOpen(true)
    const next = date.addMonths(this.data.y, this.data.m, n)
    this.planner.setMonth(next.y, next.m)
  },

  shiftMonth(e) {
    this.shift(+e.currentTarget.dataset.n)
  },

  goToday() {
    const t = date.today()
    if (this.planner) this.planner.setMonth(t.y, t.m)
  },

  goHabits() {
    wx.navigateTo({ url: '/pages/habits/index' })
  },

  /* ---------- 第一次打开：隐私政策同意卡片 ---------- */

  openLegal(e) {
    wx.navigateTo({ url: '/pages/legal/index?doc=' + e.currentTarget.dataset.doc })
  },

  // 「同意」按钮同时是微信的隐私授权按钮（open-type=agreePrivacyAuthorization），
  // 点了以后，相册、剪切板等已声明的接口也不会再弹官方隐私弹窗
  agreeConsent() {
    if (!this.data.consentAsk) return
    consent.set(true)
    this.layout({ consentAsk: false })
    sync.now()
  },

  declineConsent() {
    consent.set(false)
    this.layout({ consentAsk: false })
    wx.showToast({ title: '好的，内容只保存在这台手机上', icon: 'none' })
  },

  goMe() {
    wx.navigateTo({ url: '/pages/me/index' })
  },

  /* ---------- 贴纸条 ---------- */

  packPage(i, page) {
    const pack = this.data.packs[i]
    if (pack.id === 'tape') {
      const items = catalog.TAPES.map(t => ({ t: 't', k: t.id, css: t.css, wide: true }))
      return { trayPage: 0, trayPages: 1, items }
    }
    const keys = catalog.PACKS[i].keys
    const trayPages = Math.ceil(keys.length / STICKERS_PER_PAGE)
    const trayPage = Math.max(0, Math.min(page, trayPages - 1))
    const start = trayPage * STICKERS_PER_PAGE
    const items = keys.slice(start, start + STICKERS_PER_PAGE)
      .map(k => ({ t: 's', k, src: catalog.src(k) }))
    return { trayPage, trayPages, items }
  },

  toggleTray() {
    if (!this.planner) return
    const tray = !this.data.tray
    if (tray && !this.data.open) {
      this.planner.setOpen(true)
      if (!this.data.open) return
    }
    this.layout({ tray })
  },

  switchPack(e) {
    const packIdx = Number(e.currentTarget.dataset.i)
    this.setData({ packIdx, ...this.packPage(packIdx, 0) })
  },

  shiftTray(e) {
    const page = this.data.trayPage + Number(e.currentTarget.dataset.n)
    this.setData(this.packPage(this.data.packIdx, page))
  },

  // 按住贴纸条里的一张往上拖：手指进到画布范围后，场景里有一张悬着的贴纸跟着走
  trayStart(e) {
    const t = e.touches[0]
    const ds = e.currentTarget.dataset
    this.drag = { t: ds.t, k: ds.k, x0: t.clientX, y0: t.clientY, moved: false }
  },

  trayMove(e) {
    const d = this.drag
    if (!d || !this.planner) return
    const t = e.touches[0]
    if (!d.moved) {
      const dx = t.clientX - d.x0, dy = t.clientY - d.y0
      if (dx * dx + dy * dy < 100) return
      d.moved = true
    }
    this.planner.previewAt(d.t, d.k, t.clientX, t.clientY - this.data.topH - LIFT)
  },

  trayEnd() {
    const d = this.drag
    this.drag = null
    if (!d || !this.planner) return
    const pack = this.data.packs[this.data.packIdx]
    if (!member.canUsePack(pack)) {
      this.planner.cancelPreview()
      wx.navigateTo({ url: '/pages/member/index' })
      return
    }
    // 拖出来 = 贴到松手的位置；只是点一下 = 贴到纸页中间
    const ok = d.moved ? this.planner.commitPreview() : this.planner.addSticker(d.t, d.k)
    if (ok) {
      sound.buzz('light')
      // 用了哪种胶带，桌上那卷就换成哪种
      if (d.t === 't') this.planner.setRoll(d.k)
    } else wx.showToast({ title: d.moved ? '要贴在纸页上哦' : '等本子翻开再贴', icon: 'none', duration: 900 })
  },

  /* ---------- 在格子里写字 ---------- */

  // 镜头推到那一天的格子上，底部出现输入栏，打的字直接出现在纸页上
  startInk(p) {
    if (this.data.ink || !this.planner) return
    if (!this.planner.focusCell(p.d)) return
    const day = store.getDay(p.key)
    const d = date.parse(p.key)
    this.inkValue = day.plan
    this.planner.setDraft(p.d, day.plan)
    this.layout({ ink: { key: p.key, d: p.d, value: day.plan, title: d.m + '月' + d.d + '日' }, kb: 0 })
  },

  onInk(e) {
    this.inkValue = e.detail.value
    // 每次按键都重画整页贴图太勤，攒一下
    if (this.inkTimer) return
    this.inkTimer = setTimeout(() => {
      this.inkTimer = null
      if (this.data.ink && this.planner) this.planner.setDraft(this.data.ink.d, this.inkValue)
    }, 110)
  },

  onKeyboard(e) {
    if (!this.data.ink) return
    const kb = e.detail.height || 0
    if (kb !== this.data.kb) this.layout({ kb })
  },

  endInk() {
    const ink = this.data.ink
    if (!ink) return
    clearTimeout(this.inkTimer)
    this.inkTimer = null
    const day = store.getDay(ink.key)
    day.plan = (this.inkValue || '').trim()
    store.saveDay(ink.key, day)
    this.planner.setDraft(0)
    this.planner.unfocus()
    this.layout({ ink: null, kb: 0 })
    if (this.afterInk) {
      const next = this.afterInk
      this.afterInk = null
      next()
    }
  },

  // 这一天想多写点：去完整的日页
  openDay() {
    const ink = this.data.ink
    if (!ink) return
    this.afterInk = () => wx.navigateTo({ url: '/pages/day/index?date=' + ink.key })
    this.endInk()
  },

  noop() {}
})
