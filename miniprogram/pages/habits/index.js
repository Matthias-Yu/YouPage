// 打卡：每个习惯一张集章卡，一个月的日子排成一排排圆点，点一下盖一个章。
const store = require('../../utils/store')
const date = require('../../utils/date')
const catalog = require('../../utils/catalog')
const member = require('../../utils/member')
const sync = require('../../utils/sync')

const PRESETS = [
  { name: '早起', icon: 'wx-sunny' },
  { name: '喝水', icon: 'coffee' },
  { name: '阅读', icon: 'book' },
  { name: '运动', icon: 'dumbbell' },
  { name: '早睡', icon: 'moon' },
  { name: '学习', icon: 'pencil' },
  { name: '吃水果', icon: 'apple' },
  { name: '记账', icon: 'coin' }
]

Page({
  data: {
    y: 0,
    m: 0,
    mm: '',
    isThisMonth: true,
    habits: [],
    sheet: false,
    name: '',
    icon: catalog.HABIT_ICONS[0],
    icons: catalog.HABIT_ICONS.map(k => ({ k, src: catalog.src(k) })),
    presets: PRESETS,
    freeLimit: member.FREE_LIMITS.habits,
    beta: member.BETA_FREE
  },

  onLoad() {
    const t = date.today()
    this.setData({ y: t.y, m: t.m })
  },

  onShow() {
    this.render()
    this.offSync = sync.subscribe(type => {
      if (type === 'data') this.render()
    })
  },

  onHide() {
    if (this.offSync) this.offSync()
    this.offSync = null
  },

  onUnload() {
    this.onHide()
  },

  setSheet(open) {
    this.setData({ sheet: open })
  },

  render() {
    const { y, m } = this.data
    const t = date.today()
    const log = store.getHabitLog(date.ym(y, m))
    const total = date.daysIn(y, m)
    const isThisMonth = y === t.y && m === t.m
    const monthKey = y * 100 + m, nowKey = t.y * 100 + t.m

    const habits = store.getHabits().map(h => {
      const done = log[h.id] || {}
      const days = []
      for (let d = 1; d <= total; d++) {
        days.push({
          d,
          on: !!done[d],
          today: isThisMonth && d === t.d,
          future: monthKey > nowKey || (isThisMonth && d > t.d)
        })
      }
      return {
        id: h.id,
        name: h.name,
        src: catalog.src(h.icon),
        days,
        count: Object.keys(done).length,
        streak: store.habitStreak(h.id),
        todayDone: isThisMonth && !!done[t.d]
      }
    })

    this.setData({ mm: date.pad(m), isThisMonth, habits })
  },

  shiftMonth(e) {
    const next = date.addMonths(this.data.y, this.data.m, +e.currentTarget.dataset.n)
    this.setData({ y: next.y, m: next.m })
    this.render()
  },

  toggleDay(e) {
    const { id, d, future } = e.currentTarget.dataset
    if (future) {
      wx.showToast({ title: '还没到这一天', icon: 'none' })
      return
    }
    store.toggleHabit(id, date.ymd(this.data.y, this.data.m, d))
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.render()
  },

  toggleToday(e) {
    store.toggleHabit(e.currentTarget.dataset.id, date.today().key)
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.render()
  },

  onMore(e) {
    const id = e.currentTarget.dataset.id
    const habit = store.getHabits().find(h => h.id === id)
    if (!habit) return
    wx.showActionSheet({
      itemList: ['删除「' + habit.name + '」'],
      itemColor: '#C96F43',
      success: () => {
        wx.showModal({
          title: '删除这个习惯？',
          content: '「' + habit.name + '」和它的打卡记录将不再显示。',
          confirmText: '删除',
          confirmColor: '#C96F43',
          success: r => {
            if (!r.confirm) return
            store.saveHabits(store.getHabits().filter(h => h.id !== id))
            this.render()
          }
        })
      }
    })
  },

  /* ---------- 新建 ---------- */

  openAdd() {
    if (!member.canAddHabit(store.getHabits().length)) {
      wx.showModal({
        title: '免费版可建 ' + member.FREE_LIMITS.habits + ' 个习惯',
        content: '开通会员后不限数量。',
        confirmText: '了解会员',
        success: r => {
          if (r.confirm) wx.navigateTo({ url: '/pages/member/index' })
        }
      })
      return
    }
    this.setData({ name: '', icon: catalog.HABIT_ICONS[0] })
    this.setSheet(true)
  },

  closeAdd() {
    this.setSheet(false)
  },

  onName(e) {
    this.setData({ name: e.detail.value })
  },

  pickIcon(e) {
    this.setData({ icon: e.currentTarget.dataset.k })
  },

  pickPreset(e) {
    const p = PRESETS[e.currentTarget.dataset.i]
    this.setData({ name: p.name, icon: p.icon })
  },

  create() {
    const name = this.data.name.trim()
    if (!name) {
      wx.showToast({ title: '给习惯起个名字', icon: 'none' })
      return
    }
    const list = store.getHabits().concat({ id: 'h' + Date.now().toString(36), name, icon: this.data.icon })
    store.saveHabits(list)
    this.setSheet(false)
    this.render()
  },

  noop() {}
})
