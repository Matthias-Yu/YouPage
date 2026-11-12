// 素材目录：贴纸包、心情、天气、胶带
// 贴纸图由 tools/gen-assets.ps1 从 tools/art.json 生成到 /assets/stickers

const BASE = '/assets/stickers/'

function src(key) {
  return BASE + key + '.svg'
}

function named(prefix, list) {
  return list.map(([id, name]) => ({ id, name, key: prefix + id, src: src(prefix + id) }))
}

const MOODS = named('mood-', [
  ['happy', '开心'], ['calm', '平静'], ['meh', '一般'], ['sad', '低落'], ['angry', '生气'], ['tired', '疲惫']
])

const WEATHERS = named('wx-', [
  ['sunny', '晴'], ['cloudy', '多云'], ['overcast', '阴'], ['rain', '雨'], ['snow', '雪'], ['wind', '风']
])

// vip: 会员贴纸包（内测期间限免，见 utils/member.js）
const PACKS = [
  { id: 'daily', name: '日常', vip: false, keys: ['wx-sunny', 'wx-cloudy', 'wx-rain', 'moon', 'star', 'heart', 'flower', 'leaf', 'coffee', 'book', 'seal', 'sparkle'] },
  { id: 'mood', name: '心情', vip: false, keys: MOODS.map(m => m.key) },
  { id: 'plan', name: '计划', vip: false, keys: ['flag', 'pin', 'clock', 'calendar', 'bulb', 'pencil', 'mail', 'coin', 'gift', 'cake', 'plane', 'dumbbell'] },
  { id: 'food', name: '吃喝', vip: true, keys: ['milktea', 'donut', 'rice', 'apple', 'melon', 'icecream', 'beer', 'hotpot', 'egg'] },
  { id: 'word', name: '字签', vip: true, keys: ['w-today', 'w-go', 'w-ddl', 'w-fish', 'w-rest', 'w-pay', 'w-sleep', 'w-done'] }
]

const TAPES = [
  { id: 'gingham', name: '绿格', css: 'background-color:#E4ECD9;background-image:linear-gradient(90deg,rgba(48,83,58,.28) 50%,transparent 50%),linear-gradient(rgba(48,83,58,.28) 50%,transparent 50%);background-size:20rpx 20rpx;' },
  { id: 'stripe', name: '赤陶斜纹', css: 'background:repeating-linear-gradient(135deg,#C96F43,#C96F43 10rpx,#F3D3BE 10rpx,#F3D3BE 20rpx);' },
  { id: 'dots', name: '芥末波点', css: 'background-color:#F2D58C;background-image:radial-gradient(circle,#FFF8E9 3rpx,transparent 4rpx);background-size:18rpx 18rpx;' },
  { id: 'kraft', name: '牛皮纸', css: 'background-color:#D9C39A;background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.2),rgba(255,255,255,.2) 2rpx,transparent 2rpx,transparent 14rpx);' },
  { id: 'forest', name: '墨绿虚线', css: 'background-color:#30533A;background-image:linear-gradient(90deg,#FCF0DA 50%,transparent 50%);background-size:24rpx 4rpx;background-repeat:repeat-x;background-position:0 50%;' },
  { id: 'sky', name: '晴空细纹', css: 'background:repeating-linear-gradient(90deg,#CFE0E6,#CFE0E6 8rpx,#EAF2F4 8rpx,#EAF2F4 16rpx);' }
]

// 习惯打卡可选的图标
const HABIT_ICONS = ['wx-sunny', 'coffee', 'book', 'dumbbell', 'moon', 'pencil', 'leaf', 'heart', 'apple', 'coin']

function byId(list, id) {
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
  return null
}

function moodSrc(id) {
  const m = byId(MOODS, id)
  return m ? m.src : ''
}

function weatherSrc(id) {
  const w = byId(WEATHERS, id)
  return w ? w.src : ''
}

function tapeCss(id) {
  const t = byId(TAPES, id)
  return t ? t.css : TAPES[0].css
}

// 字签贴纸是 2:1 的横向贴纸
function isWide(key) {
  return key.indexOf('w-') === 0
}

module.exports = { MOODS, WEATHERS, PACKS, TAPES, HABIT_ICONS, src, moodSrc, weatherSrc, tapeCss, isWide }
