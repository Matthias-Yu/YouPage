// 会员页：现在只展示权益，没有接支付（见 utils/member.js）
const member = require('../../utils/member')
const catalog = require('../../utils/catalog')

Page({
  data: {
    beta: member.BETA_FREE,
    isMember: false,
    benefits: member.BENEFITS.map(b => Object.assign({}, b, { src: catalog.src(b.icon) }))
  },

  onShow() {
    this.setData({ isMember: member.status().member })
  },

  back() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/index' }) })
  }
})
