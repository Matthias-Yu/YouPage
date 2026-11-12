// 会员与权益开关。
// 现在没有接支付：BETA_FREE 为 true 时所有权益对所有人开放（界面显示「限免」）。
// 正式收费时：1) 把 BETA_FREE 改成 false；2) 让 status() 读取服务端下发的会员状态。

const BETA_FREE = true

// 免费版的额度；会员不受限
const FREE_LIMITS = { habits: 3 }

// 会员页展示的权益。ready=false 的是规划中、尚未实现的功能
const BENEFITS = [
  { icon: 'milktea', title: '全部贴纸包', desc: '吃喝、字签，以及之后每月上新的主题包', ready: true },
  { icon: 'seal', title: '打卡不限数量', desc: '免费版可建 ' + FREE_LIMITS.habits + ' 个习惯，会员不设上限', ready: true },
  { icon: 'wx-cloudy', title: '云端同步', desc: '换手机、删小程序都不丢，多设备同一本手帐', ready: true },
  { icon: 'mail', title: '导出长图 / PDF', desc: '把某一天或一整月做成图片，发朋友圈、发小红书', ready: false },
  { icon: 'book', title: '封皮与纸张', desc: '更多封皮颜色、方格 / 点阵 / 空白内页', ready: false }
]

function status() {
  return { member: false, beta: BETA_FREE, expireAt: 0 }
}

function unlocked() {
  const s = status()
  return s.beta || s.member
}

// 会员贴纸包能不能用
function canUsePack(pack) {
  return !pack.vip || unlocked()
}

// 还能不能再建一个习惯
function canAddHabit(currentCount) {
  return unlocked() || currentCount < FREE_LIMITS.habits
}

// 云端同步是会员权益
function canSync() {
  return unlocked()
}

module.exports = { BETA_FREE, FREE_LIMITS, BENEFITS, status, unlocked, canUsePack, canAddHabit, canSync }
