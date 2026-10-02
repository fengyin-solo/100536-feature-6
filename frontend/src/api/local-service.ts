import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 办理回填时随动作一起带上来的现场复测信息：复测面积留空表示沿用台账里的布方面积。
export type BackfillPayload = {
  remeasuredArea?: string
  remeasuredBy?: string
}

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

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  // 探方回填要先核对面积与层位、留存复测记录并转验收待办，走专门入口，不与普通动作混用。
  if (key === 'trench' && action === '办理回填') {
    return backfillTrench(id, {})
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
  const from = meta.actionFrom?.[action]
  if (from && current !== from) {
    return {
      ok: false,
      message: `${meta.entity}当前状态是「${current}」，只能由「${from}」${action}，状态要逐段往下流转，不许跳级`,
    }
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
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 探方回填：先核对布方面积与起始层位是否齐备，面积缺失一律退回、不保存；
// 现场复测面积优先于台账值，复测记录随探方留存，不再重算；存量探方不动，沿用老数据里的取值。
// 回填收尾后在探方验收落一张「待验收」待办单。
export function backfillTrench(id: number, payload: BackfillPayload): ActionResult {
  const meta = moduleMeta('trench')
  const rows = listRows('trench')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const code = String(row['探方编号'] ?? id)
  const current = String(row.status)
  if (current === '已回填') {
    return { ok: false, message: `${meta.entity}已经是「已回填」，不用重复操作` }
  }
  if (current !== '已停掘') {
    return {
      ok: false,
      message: `探方 ${code} 当前状态是「${current}」，只能由「已停掘」办理回填，状态要逐段往下流转，不许跳级`,
    }
  }
  const remeasuredArea = (payload.remeasuredArea ?? '').trim()
  const ledgerArea = String(row['布方面积'] ?? '').trim()
  const finalArea = remeasuredArea || ledgerArea
  if (!finalArea) {
    return {
      ok: false,
      message: `探方 ${code} 布方面积缺失，回填申请已退回，本次不保存；请先补录台账或填写现场复测面积`,
    }
  }
  if (!String(row['起始层位'] ?? '').trim()) {
    return {
      ok: false,
      message: `探方 ${code} 起始层位缺失，回填申请已退回，本次不保存；请先补录起始层位`,
    }
  }
  const updated: EntryRow = { ...row, 布方面积: finalArea, status: '已回填', pending: false }
  let remeasureNote = ''
  if (remeasuredArea) {
    const remeasuredBy = (payload.remeasuredBy ?? '').trim() || '现场记录员'
    const remeasuredAt = new Date().toISOString().slice(0, 10)
    if (updated['台账布方面积'] === undefined) {
      updated['台账布方面积'] = ledgerArea
    }
    updated['复测布方面积'] = remeasuredArea
    updated['复测人'] = remeasuredBy
    updated['复测日期'] = remeasuredAt
    updated['复测记录'] =
      remeasuredArea === ledgerArea
        ? `${remeasuredAt} ${remeasuredBy}现场复测：布方面积 ${remeasuredArea}，与台账一致，以现场复测为准`
        : `${remeasuredAt} ${remeasuredBy}现场复测：台账 ${ledgerArea || '（缺失）'}，复测 ${remeasuredArea}，以现场复测为准，不再重算`
    remeasureNote = '，复测记录已留存'
  }
  const next = [...rows]
  next[index] = updated
  saveRows('trench', next)
  const todoCode = createAcceptanceTodo(updated)
  return {
    ok: true,
    message: `探方 ${code} 已办理回填，当前状态「已回填」${remeasureNote}；验收待办单 ${todoCode} 已转到探方验收`,
  }
}

// 回填收尾的批复落到探方验收：追加一张「待验收」待办单。
function createAcceptanceTodo(trench: EntryRow): string {
  const rows = listRows('acceptance')
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const code = `ACCE-${String(nextId).padStart(4, '0')}`
  const todo: EntryRow = {
    id: nextId,
    status: '待验收',
    pending: true,
    abnormal: false,
    验收单号: code,
    验收探方: String(trench['探方编号'] ?? ''),
    验收类别: '回填验收',
    验收人: '',
    验收日期: '',
    遗留问题数: 0,
    验收结论: '',
    验收状态: '待验收',
  }
  saveRows('acceptance', [...rows, todo])
  return code
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
