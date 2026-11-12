// 有页 · 每天，有一页。
const config = require('./config')
const sync = require('./utils/sync')

App({
  globalData: {
    // 本次启动是否已经展示过封面
    coverShown: false
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init(config.CLOUD_ENV ? { env: config.CLOUD_ENV, traceUser: true } : { traceUser: true })
    }
    sync.start()
  },

  onShow() {
    sync.kick()
  },

  onHide() {
    sync.flush()
  }
})
