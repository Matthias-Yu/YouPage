// 素材目录：猫猫贴纸、拼贴、心情、天气和胶带
const BASE = '/assets/stickers/'
const DEFAULT_STICKER = 's19'

// 老备份和已贴出的贴纸保留原 key，显示时换成相近的原站图案。
const LEGACY_STICKERS = {
  'wx-sunny': 's37', 'wx-cloudy': 's38', 'wx-overcast': 's39',
  'wx-rain': 's40', 'wx-snow': 's43', 'wx-wind': 's44',
  'mood-happy': 's19', 'mood-calm': 'ins04', 'mood-meh': 's49',
  'mood-sad': 's46', 'mood-angry': 's47', 'mood-tired': 's20',
  moon: 's50', star: 'ins32', heart: 'ins14', flower: 's12', leaf: 's26',
  coffee: 's28', book: 'ins05', seal: 's01', sparkle: 's54',
  flag: 's16', pin: 's04', clock: 's01', calendar: 's05', bulb: 's52',
  pencil: 's03', mail: 's06', coin: 's06', gift: 's18', cake: 's31',
  plane: 's04', dumbbell: 's21', milktea: 's29', donut: 'ins12',
  rice: 's35', apple: 's34', melon: 's34', icecream: 'ins16',
  beer: 's33', hotpot: 's30', egg: 's36',
  'w-today': 's01', 'w-go': 's21', 'w-ddl': 's05', 'w-fish': 's07',
  'w-rest': 's09', 'w-pay': 's06', 'w-sleep': 's50', 'w-done': 's08'
}

function stickerRange(prefix, first, last) {
  return Array.from({ length: last - first + 1 }, (_, i) => prefix + String(first + i).padStart(2, '0'))
}

// vip: 会员贴纸包（内测期间限免，见 utils/member.js）
const PACKS = [
  { id: 'plan', name: '日常', vip: false, keys: stickerRange('s', 1, 9).concat(stickerRange('s', 21, 27)) },
  { id: 'holiday', name: '节日', vip: false, keys: stickerRange('s', 10, 18) },
  { id: 'mood', name: '心情', vip: false, keys: ['s19', 's20'].concat(stickerRange('s', 46, 54)) },
  { id: 'weather', name: '天气', vip: false, keys: stickerRange('s', 37, 45) },
  { id: 'food', name: '吃喝', vip: true, keys: stickerRange('s', 28, 36) },
  { id: 'collage', name: '拼贴', vip: true, keys: stickerRange('ins', 1, 36) }
]
const STICKER_KEYS = new Set(PACKS.reduce((keys, pack) => keys.concat(pack.keys), []))

function stickerKey(key) {
  if (STICKER_KEYS.has(key)) return key
  return Object.prototype.hasOwnProperty.call(LEGACY_STICKERS, key)
    ? LEGACY_STICKERS[key] : DEFAULT_STICKER
}

function src(key) {
  return BASE + stickerKey(key) + '.png'
}

function named(prefix, list) {
  return list.map(([id, name]) => {
    const key = stickerKey(prefix + id)
    return { id, name, key, src: src(key) }
  })
}

const MOODS = named('mood-', [
  ['happy', '开心'], ['calm', '平静'], ['meh', '一般'],
  ['sad', '低落'], ['angry', '生气'], ['tired', '疲惫']
])

const WEATHERS = named('wx-', [
  ['sunny', '晴'], ['cloudy', '多云'], ['overcast', '阴'],
  ['rain', '雨'], ['snow', '雪'], ['wind', '风']
])

const TAPES = [
  { id: 'gingham', name: '灰格', css: 'background-color:#EAEAEA;background-image:linear-gradient(90deg,rgba(55,55,55,.28) 50%,transparent 50%),linear-gradient(rgba(55,55,55,.28) 50%,transparent 50%);background-size:20rpx 20rpx;' },
  { id: 'stripe', name: '石墨斜纹', css: 'background:repeating-linear-gradient(135deg,#787878,#787878 10rpx,#E4E4E4 10rpx,#E4E4E4 20rpx);' },
  { id: 'dots', name: '银灰波点', css: 'background-color:#AFAFAF;background-image:radial-gradient(circle,#FAFAFA 3rpx,transparent 4rpx);background-size:18rpx 18rpx;' },
  { id: 'kraft', name: '灰纸纹', css: 'background-color:#C1C1C1;background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.2),rgba(255,255,255,.2) 2rpx,transparent 2rpx,transparent 14rpx);' },
  { id: 'forest', name: '炭黑虚线', css: 'background-color:#363636;background-image:linear-gradient(90deg,#ECECEC 50%,transparent 50%);background-size:24rpx 4rpx;background-repeat:repeat-x;background-position:0 50%;' },
  { id: 'sky', name: '浅灰细纹', css: 'background:repeating-linear-gradient(90deg,#D1D1D1,#D1D1D1 8rpx,#F0F0F0 8rpx,#F0F0F0 16rpx);' }
]

// 习惯打卡可选的图标
const HABIT_ICONS = ['s37', 's28', 'ins05', 's21', 's50', 's03', 's26', 's48', 's34', 's06', 's01']

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

// 老字签保留原来的横向占位。
function isWide(key) {
  return typeof key === 'string' && key.indexOf('w-') === 0
}

module.exports = { MOODS, WEATHERS, PACKS, TAPES, HABIT_ICONS, src, stickerKey, moodSrc, weatherSrc, tapeCss, isWide }
