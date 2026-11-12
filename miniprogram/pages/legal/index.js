// 隐私政策 / 用户协议。?doc=privacy | terms
const legal = require('../../utils/legal')

Page({
  data: {
    doc: null,
    isPrivacy: true,
    contract: ''
  },

  onLoad(query) {
    const isPrivacy = query.doc !== 'terms'
    const doc = isPrivacy ? legal.privacy() : legal.terms()
    this.setData({ doc, isPrivacy })
    wx.setNavigationBarTitle({ title: doc.title })
    // 公众平台后台配置的《用户隐私保护指引》，由微信展示
    if (isPrivacy && wx.getPrivacySetting) {
      wx.getPrivacySetting({
        success: res => this.setData({ contract: res.privacyContractName || '' })
      })
    }
  },

  openContract() {
    wx.openPrivacyContract({ fail: () => wx.showToast({ title: '暂时打不开', icon: 'none' }) })
  },

  openOther() {
    wx.redirectTo({ url: '/pages/legal/index?doc=' + (this.data.isPrivacy ? 'terms' : 'privacy') })
  }
})
