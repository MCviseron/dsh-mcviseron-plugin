export const zh = {
  'row.title': '按时间自动切换深浅色',
  'row.description': '按本机时间在浅色与深色之间自动切换：早间时段用浅色，其余时间用深色',
  'row.enable': '开启按时间自动切换深浅色',
  'row.disable': '关闭按时间自动切换深浅色',
  'row.lightStart': '早间开始',
  'row.lightEnd': '早间结束',
  'row.dash': '至',
  'row.next': '下次切换',
  'row.timeHint': '使用本机时间，自动适配时区与夏令时',
  'status.light': '当前为早间（浅色）',
  'status.dark': '当前为晚间（深色）',
  'status.off': '已关闭，配色跟随外观设置中的选择',
  'status.unavailable': '无法读取插件设置：请确认 profile 中的插件条目 id 为 mcviseron',
  'status.saving': '保存中…',
  'status.saved': '已保存',
  'status.failed': '保存失败，请重试',
} as const

export const en = {
  'row.title': 'Switch light/dark by time',
  'row.description': 'Follow the local wall clock: light during the morning window, dark for the rest of the day',
  'row.enable': 'Enable the light/dark schedule',
  'row.disable': 'Disable the light/dark schedule',
  'row.lightStart': 'Light starts',
  'row.lightEnd': 'Light ends',
  'row.dash': 'to',
  'row.next': 'Next switch',
  'row.timeHint': 'Uses the local wall clock; time zones and daylight saving are handled automatically',
  'status.light': 'Morning window (light)',
  'status.dark': 'Evening window (dark)',
  'status.off': 'Off — the palette follows the Appearance choice',
  'status.unavailable': 'Cannot read the plugin settings: check that the profile entry id is mcviseron',
  'status.saving': 'Saving…',
  'status.saved': 'Saved',
  'status.failed': 'Save failed — try again',
} satisfies Record<keyof typeof zh, string>

export type McviseronKey = keyof typeof zh
