import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult, RemeasureInput } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 探方复测记录单独存一份，跟着探方编号走，不走模块元数据。
const REMEASURE_KEY = 'trench-remeasure'

// 只有布方完成、尚未回填的探方才受理现场复测。
const REMEASURE_STATUSES = ['发掘中', '已停掘']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getEntry(key: string, id: number): EntryRow | null {
  return listRows(key).find((row) => Number(row.id) === id) ?? null
}

// 逐段流转的模块按当前状态给出下一步可执行的动作，页面只负责渲染。
export function availableActions(key: string, row: EntryRow): string[] {
  const meta = moduleMeta(key)
  if (!meta.stepwise) {
    return meta.actions
  }
  const current = String(row.status)
  return meta.actions.filter((action) => {
    const targetIndex = meta.statuses.indexOf(meta.actionTargets[action])
    return targetIndex > 0 && meta.statuses[targetIndex - 1] === current
  })
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (meta.stepwise) {
    const targetIndex = meta.statuses.indexOf(target)
    const expected = targetIndex > 0 ? meta.statuses[targetIndex - 1] : ''
    if (current !== expected) {
      return {
        ok: false,
        message: `${meta.entity}状态只能逐段流转（${meta.statuses.join('→')}），当前「${current}」不能跳级执行「${action}」`,
      }
    }
  }
  const missing = (meta.actionRequires?.[action] ?? []).filter(
    (field) => String(rows[index][field] ?? '').trim() === '',
  )
  if (missing.length > 0) {
    return { ok: false, message: `${action}前须先核对${missing.join('、')}是否齐备，当前缺失，不予流转` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  const extra = POST_ACTION_EFFECTS[`${key}:${action}`]?.(updated)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${extra ? `；${extra}` : ''}` }
}

// 回填收尾的批复落到探方验收：回填办结时自动补一张待验收的待办单。
function createAcceptanceTodo(trench: EntryRow): EntryRow {
  const rows = listRows('acceptance')
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const todo: EntryRow = {
    id: nextId,
    status: '待验收',
    pending: true,
    abnormal: false,
    验收单号: `ACCE-${String(nextId).padStart(4, '0')}`,
    验收探方: String(trench['探方编号'] ?? ''),
    验收类别: '回填收尾验收',
    验收人: '',
    验收日期: '',
    遗留问题数: 0,
    验收结论: '',
    验收状态: '待验收',
  }
  saveRows('acceptance', [...rows, todo])
  return todo
}

const POST_ACTION_EFFECTS: Record<string, (row: EntryRow) => string> = {
  'trench:办理回填': (row) => {
    const todo = createAcceptanceTodo(row)
    return `回填收尾批复已转入探方验收待办（${String(todo['验收单号'])}）`
  },
}

export function canRemeasure(row: EntryRow): boolean {
  return REMEASURE_STATUSES.includes(String(row.status))
}

export function listRemeasures(trenchNo = ''): EntryRow[] {
  const rows = listRows(REMEASURE_KEY)
  const keyword = trenchNo.trim()
  if (!keyword) {
    return rows
  }
  return rows.filter((row) => String(row['探方编号']) === keyword)
}

// 现场复测：布方面积缺失一律退回不许保存；保存后以复测值为准，不再重算，记录一并留存。
export function recordRemeasure(input: RemeasureInput): ActionResult {
  const trenchNo = input.探方编号.trim()
  const area = input.复测布方面积.trim()
  if (!area) {
    return { ok: false, message: '布方面积缺失，复测记录一律退回，本次不予保存' }
  }
  const trenches = listRows('trench')
  const index = trenches.findIndex((row) => String(row['探方编号']) === trenchNo)
  if (index < 0) {
    return { ok: false, message: `没有找到探方编号为 ${trenchNo} 的探方` }
  }
  const trench = trenches[index]
  if (!canRemeasure(trench)) {
    return {
      ok: false,
      message: `探方当前「${String(trench.status)}」，不在可复测阶段（发掘中、已停掘），复测记录退回未保存`,
    }
  }
  const records = listRows(REMEASURE_KEY)
  const record: EntryRow = {
    id: records.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1,
    status: '已记录',
    pending: false,
    abnormal: false,
    探方编号: trenchNo,
    台账布方面积: String(trench['布方面积'] ?? ''),
    复测布方面积: area,
    复测人: input.复测人.trim(),
    复测日期: input.复测日期.trim(),
    备注: input.备注.trim(),
  }
  // 以现场复测的布方面积为准，直接采用复测值，不再重算；未复测的存量探方仍沿用老数据里的取值。
  const next = [...trenches]
  next[index] = { ...trench, 布方面积: area }
  saveRows('trench', next)
  saveRows(REMEASURE_KEY, [...records, record])
  return { ok: true, message: `已登记复测：${trenchNo} 布方面积以现场复测值 ${area} 为准，不再重算` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
