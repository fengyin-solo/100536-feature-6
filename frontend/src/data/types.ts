/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  /** 为 true 时状态只能按 statuses 顺序逐段往下流转，不许跳级。 */
  stepwise?: boolean
  /** 动作的前置必填字段：缺失即退回，不予流转。 */
  actionRequires?: Record<string, string[]>
  metrics: string[]
}

/** 现场复测登记的入参：布方面积必填，缺失一律退回。 */
export type RemeasureInput = {
  探方编号: string
  复测布方面积: string
  复测人: string
  复测日期: string
  备注: string
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
