// 日期、月历网格、农历与节日

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']
const MONTH_EN = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']
const MONTH_CN = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
const DAY_MS = 864e5

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function ym(y, m) {
  return y + '-' + pad(m)
}

function ymd(y, m, d) {
  return y + '-' + pad(m) + '-' + pad(d)
}

function parse(key) {
  const a = key.split('-')
  return { y: +a[0], m: +a[1], d: +a[2] }
}

function fromDate(dt) {
  const y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate()
  return { y, m, d, wd: dt.getDay(), key: ymd(y, m, d) }
}

function today() {
  return fromDate(new Date())
}

function daysIn(y, m) {
  return new Date(y, m, 0).getDate()
}

function weekday(y, m, d) {
  return new Date(y, m - 1, d).getDay()
}

function addDays(key, n) {
  const p = parse(key)
  return fromDate(new Date(p.y, p.m - 1, p.d + n)).key
}

function addMonths(y, m, n) {
  const dt = new Date(y, m - 1 + n, 1)
  return { y: dt.getFullYear(), m: dt.getMonth() + 1 }
}

// weekStart: 1 = 周一开头，0 = 周日开头
function weekNames(weekStart) {
  const out = []
  for (let i = 0; i < 7; i++) {
    const wd = (weekStart + i) % 7
    out.push({ name: WEEK_CN[wd], we: wd === 0 || wd === 6 })
  }
  return out
}

// 返回整行整行的格子（5 或 6 行），月外的格子 inMonth=false
function monthGrid(y, m, weekStart) {
  const first = weekday(y, m, 1)
  const lead = (first - weekStart + 7) % 7
  const total = daysIn(y, m)
  const rows = Math.ceil((lead + total) / 7)
  const cells = []
  for (let i = 0; i < rows * 7; i++) {
    const d = i - lead + 1
    if (d < 1 || d > total) {
      cells.push({ key: 'x' + i, inMonth: false })
    } else {
      cells.push({ key: ymd(y, m, d), d, wd: (weekStart + i) % 7, inMonth: true })
    }
  }
  return cells
}

/* ---------- 农历 ----------
 * 每年：[春节的公历月日(MMDD), 闰月(0=无), 各月大小(按月序排列，含闰月；bit=1 为 30 天)]
 * 2020–2036，已与紫金山天文台历表口径核对（2027、2030 春节为 2/6、2/3）。
 * 超出范围时 lunar() 返回 null，界面上不显示农历。
 */
const LUNAR = {
  2020: [125, 4, 5422], 2021: [212, 0, 1366], 2022: [201, 0, 2741], 2023: [122, 2, 5554],
  2024: [210, 0, 1746], 2025: [129, 6, 3749], 2026: [217, 0, 1829], 2027: [206, 0, 1611],
  2028: [126, 5, 3223], 2029: [213, 0, 3243], 2030: [203, 0, 1370], 2031: [123, 3, 2774],
  2032: [211, 0, 2921], 2033: [131, 11, 5970], 2034: [219, 0, 2898], 2035: [208, 0, 2853],
  2036: [128, 6, 6731]
}
const L_MONTH = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
const L_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const L_TEN = ['初', '十', '廿']

function lunarStart(y) {
  const info = LUNAR[y]
  return info ? Date.UTC(y, Math.floor(info[0] / 100) - 1, info[0] % 100) : null
}

function lunar(y, m, d) {
  const t = Date.UTC(y, m - 1, d)
  let ly = y
  let start = lunarStart(ly)
  if (start === null || t < start) {
    ly = y - 1
    start = lunarStart(ly)
    if (start === null) return null
  }
  const leap = LUNAR[ly][1], bits = LUNAR[ly][2], n = leap ? 13 : 12
  let off = Math.round((t - start) / DAY_MS)
  for (let i = 0; i < n; i++) {
    const len = (bits >> i) & 1 ? 30 : 29
    if (off < len) {
      let month = i + 1, isLeap = false
      if (leap && i >= leap) {
        month = i
        isLeap = i === leap
      }
      return { year: ly, month, day: off + 1, leap: isLeap, eve: i === n - 1 && off === len - 1 }
    }
    off -= len
  }
  return null
}

function lunarDayName(d) {
  if (d === 10) return '初十'
  if (d === 20) return '二十'
  if (d === 30) return '三十'
  return L_TEN[Math.floor(d / 10)] + L_NUM[d % 10 - 1]
}

function lunarText(lu) {
  if (!lu) return ''
  return (lu.leap ? '闰' : '') + L_MONTH[lu.month - 1] + '月' + lunarDayName(lu.day)
}

const SOLAR_FEST = {
  '1-1': '元旦', '2-14': '情人节', '3-8': '妇女节', '5-1': '劳动节', '6-1': '儿童节',
  '9-10': '教师节', '10-1': '国庆', '12-24': '平安夜', '12-25': '圣诞'
}
const LUNAR_FEST = {
  '1-1': '春节', '1-15': '元宵', '5-5': '端午', '7-7': '七夕', '8-15': '中秋', '9-9': '重阳', '12-8': '腊八'
}

function festival(y, m, d, lu) {
  if (lu === undefined) lu = lunar(y, m, d)
  if (lu && !lu.leap) {
    if (lu.eve) return '除夕'
    const f = LUNAR_FEST[lu.month + '-' + lu.day]
    if (f) return f
  }
  const s = SOLAR_FEST[m + '-' + d]
  if (s) return s
  if (y >= 2000 && y < 2100) {
    const yy = y % 100
    // 节气公式（21 世纪系数），只取两个最常记在手帐里的
    if (m === 4 && d === Math.floor(yy * 0.2422 + 4.81) - Math.floor(yy / 4)) return '清明'
    if (m === 12 && d === Math.floor(yy * 0.2422 + 21.94) - Math.floor(yy / 4)) return '冬至'
  }
  return ''
}

module.exports = {
  WEEK_CN, MONTH_EN, MONTH_CN,
  pad, ym, ymd, parse, today, fromDate, daysIn, weekday, addDays, addMonths,
  weekNames, monthGrid, lunar, lunarText, festival
}
