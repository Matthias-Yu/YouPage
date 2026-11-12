// 我的：统计、会员入口、设置、备份与恢复
const store = require('../../utils/store')
const date = require('../../utils/date')
const member = require('../../utils/member')
const sync = require('../../utils/sync')
const consent = require('../../utils/consent')

function clock(t) {
  const d = new Date(t)
  const hm = date.pad(d.getHours()) + ':' + date.pad(d.getMinutes())
  const today = date.today()
  if (d.getFullYear() === today.y && d.getMonth() + 1 === today.m && d.getDate() === today.d) return '今天 ' + hm
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm
}

function syncView() {
  const s = sync.status()
  let text
  if (!s.on && !consent.get().ok) text = '未开启：需要你先同意隐私政策'
  else if (!s.on) text = member.canSync() ? '已关闭，手帐只存在这台手机上' : '会员权益，开通后可用'
  else if (s.state === 'syncing') text = '同步中…'
  else if (s.state === 'error') text = s.err || '同步失败，稍后会自动重试'
  else if (s.at) text = '上次同步 ' + clock(s.at) + (s.pending ? '，还有 ' + s.pending + ' 项待同步' : '')
  else text = '还没同步过'
  return { available: s.available, on: s.on, state: s.state, text }
}

Page({
  data: {
    stats: { pages: 0, streak: 0, stickers: 0 },
    cover: true,
    sound: true,
    weekStart: 1,
    beta: member.BETA_FREE,
    isMember: false,
    sync: { available: false, on: false, state: 'off', text: '' }
  },

  onShow() {
    this.render()
    this.off = sync.subscribe(type => {
      if (type === 'data') this.render()
      else this.setData({ sync: syncView() })
    })
  },

  onHide() {
    if (this.off) this.off()
    this.off = null
  },

  onUnload() {
    this.onHide()
  },

  onSync(e) {
    const on = e.detail.value
    if (on && !member.canSync()) {
      this.setData({ sync: syncView() })
      wx.navigateTo({ url: '/pages/member/index' })
      return
    }
    if (on && !consent.get().ok) {
      // 之前没同意过隐私政策：开同步前再问一次
      this.setData({ sync: syncView() })
      wx.showModal({
        title: '开启云端同步',
        content: '开启后，你写的内容和贴的照片会保存到云端（腾讯云开发），用于换手机时找回。详见下方的《隐私政策》。',
        confirmText: '同意并开启',
        confirmColor: '#30533A',
        success: r => {
          if (!r.confirm) return
          consent.set(true)
          sync.setEnabled(true)
          this.setData({ sync: syncView() })
        }
      })
      return
    }
    sync.setEnabled(on)
    this.setData({ sync: syncView() })
  },

  syncNow() {
    sync.now().then(() => this.render())
  },

  openLegal(e) {
    wx.navigateTo({ url: '/pages/legal/index?doc=' + e.currentTarget.dataset.doc })
  },

  wipeCloud() {
    wx.showModal({
      title: '删除云端数据？',
      content: '云端保存的全部手帐和照片会被永久删除，无法恢复。这台手机上的内容会保留，并关闭这台手机的云端同步。其他设备上已有的内容不受影响，但如果它们还开着同步，之后的修改会重新上传。',
      confirmText: '删除',
      confirmColor: '#C96F43',
      success: r => {
        if (!r.confirm) return
        wx.showLoading({ title: '正在删除', mask: true })
        sync.wipeCloud().then(res => {
          wx.hideLoading()
          wx.showToast({ title: '已删除 ' + (res.removed || 0) + ' 份云端数据', icon: 'none' })
          this.render()
        }, err => {
          wx.hideLoading()
          console.warn('[me] wipe failed', err)
          wx.showModal({ title: '没有删除成功', content: '网络不太好，或者有照片没能先保存到这台手机。云端数据还在，请稍后再试。', showCancel: false })
          this.render()
        })
      }
    })
  },

  onShareAppMessage() {
    return { title: '有页｜每天，有一页', path: '/pages/home/index' }
  },

  render() {
    const s = store.getSettings()
    this.setData({
      stats: store.stats(),
      cover: s.cover,
      sound: s.sound,
      weekStart: s.weekStart,
      isMember: member.status().member,
      sync: syncView()
    })
  },

  openMember() {
    wx.navigateTo({ url: '/pages/member/index' })
  },

  onCover(e) {
    store.setSetting('cover', e.detail.value)
  },

  onSound(e) {
    store.setSetting('sound', e.detail.value)
  },

  onWeekStart() {
    wx.showActionSheet({
      itemList: ['周一开头', '周日开头'],
      success: r => {
        const weekStart = r.tapIndex === 0 ? 1 : 0
        store.setSetting('weekStart', weekStart)
        this.setData({ weekStart })
      }
    })
  },

  /* ---------- 备份 ---------- */

  // 导出成一个 json 文件，通过微信发给自己（文件传输助手）保存
  exportBackup() {
    const json = JSON.stringify(store.exportAll())
    const name = 'youpage-backup-' + date.today().key + '.json'
    const path = wx.env.USER_DATA_PATH + '/' + name
    const toClipboard = () => {
      wx.setClipboardData({
        data: json,
        success: () => wx.showModal({ title: '已复制备份内容', content: '把它粘贴到备忘录或发给自己保存。恢复时选「从剪贴板恢复」。', showCancel: false })
      })
    }
    try {
      wx.getFileSystemManager().writeFileSync(path, json, 'utf8')
    } catch (e) {
      toClipboard()
      return
    }
    if (!wx.shareFileMessage) {
      toClipboard()
      return
    }
    wx.shareFileMessage({
      filePath: path,
      fileName: name,
      fail: err => {
        // 用户自己取消不算失败；开发者工具等不支持发文件的环境退回到剪贴板
        if (err && /cancel/.test(err.errMsg || '')) return
        toClipboard()
      }
    })
  },

  importFromFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: res => {
        wx.getFileSystemManager().readFile({
          filePath: res.tempFiles[0].path,
          encoding: 'utf8',
          success: r => this.restore(r.data),
          fail: () => wx.showToast({ title: '读不了这个文件', icon: 'none' })
        })
      }
    })
  },

  importFromClipboard() {
    wx.getClipboardData({
      success: r => this.restore(r.data)
    })
  },

  importBackup() {
    wx.showActionSheet({
      itemList: ['从聊天里的备份文件恢复', '从剪贴板恢复'],
      success: r => (r.tapIndex === 0 ? this.importFromFile() : this.importFromClipboard())
    })
  },

  restore(text) {
    let obj = null
    try {
      obj = JSON.parse(text)
    } catch (e) {}
    if (!obj || obj.app !== 'youpage' || !obj.data) {
      wx.showToast({ title: '这不是有页的备份', icon: 'none' })
      return
    }
    wx.showModal({
      title: '用这份备份覆盖现在的手帐？',
      content: '备份时间 ' + String(obj.exportedAt || '').slice(0, 10) + '。现在的内容会被替换' +
        (sync.status().on ? '，云端和其他设备也会跟着变成这份备份' : '') + '，无法撤销。',
      confirmText: '恢复',
      confirmColor: '#C96F43',
      success: r => {
        if (!r.confirm) return
        try {
          const pages = store.importAll(obj)
          wx.showToast({ title: '已恢复 ' + pages + ' 页', icon: 'none' })
        } catch (e) {
          wx.showToast({ title: '恢复失败', icon: 'none' })
        }
        this.render()
      }
    })
  },

  clearAll() {
    wx.showModal({
      title: '清空整本手帐？',
      content: '所有日页、贴纸和打卡记录都会被删除' +
        (sync.status().on ? '，云端和其他设备上也会一起清空' : '') + '，无法撤销。建议先备份。',
      confirmText: '清空',
      confirmColor: '#C96F43',
      success: r => {
        if (!r.confirm) return
        // 已经同步到云存储的照片也一起删掉
        const photos = []
        JSON.stringify(store.exportAll().data).replace(/cloud:\/\/[^"\\\s]+/g, id => {
          if (photos.indexOf(id) < 0) photos.push(id)
          return id
        })
        store.clearAll()
        if (photos.length && wx.cloud) {
          for (let i = 0; i < photos.length; i += 50) wx.cloud.deleteFile({ fileList: photos.slice(i, i + 50), fail() {} })
        }
        this.render()
        wx.showToast({ title: '已清空', icon: 'none' })
      }
    })
  }
})
