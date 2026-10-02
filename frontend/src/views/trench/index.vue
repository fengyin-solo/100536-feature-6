<template>
  <section class="page" data-module="trench">
    <header class="page-head">
      <div>
        <h2>探方登记管理</h2>
        <p class="page-desc">维护探方，围绕探方编号、所属发掘区、布方面积、起始层位做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记探方</button>
        <button class="btn" type="button" @click="exportRows">导出探方登记清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in rowActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button v-if="canRemeasureRow(row)" class="link" type="button" @click="openRemeasure(row)">
              登记复测
            </button>
            <button class="link" type="button" @click="openDetail(row)">详情</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无探方登记数据，可先登记探方</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条探方登记记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detailRow" class="modal-mask" @click.self="closeDetail">
      <div class="modal-card">
        <div class="modal-head">
          <h3>探方详情 · {{ detailRow['探方编号'] }}</h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </div>
        <div class="detail-grid">
          <p v-for="column in columns" :key="column" class="detail-item">
            <span class="k">{{ column }}</span>{{ detailRow[column] ?? '—' }}
          </p>
          <p class="detail-item"><span class="k">当前状态</span>{{ detailRow.status }}</p>
        </div>
        <h4 class="sub-title">现场复测记录</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>复测日期</th>
              <th>台账布方面积</th>
              <th>复测布方面积</th>
              <th>复测人</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in detailRemeasures" :key="String(item.id)">
              <td>{{ item['复测日期'] || '—' }}</td>
              <td>{{ item['台账布方面积'] || '—' }}</td>
              <td>{{ item['复测布方面积'] }}</td>
              <td>{{ item['复测人'] || '—' }}</td>
              <td>{{ item['备注'] || '—' }}</td>
            </tr>
            <tr v-if="!detailRemeasures.length">
              <td colspan="5" class="empty-state">暂无复测记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="remeasureTarget" class="modal-mask" @click.self="cancelRemeasure">
      <div class="modal-card">
        <div class="modal-head">
          <h3>登记现场复测 · {{ remeasureTarget['探方编号'] }}</h3>
          <button class="link" type="button" @click="cancelRemeasure">取消</button>
        </div>
        <p class="page-desc">
          台账布方面积：{{ remeasureTarget['布方面积'] || '—' }}；保存后以现场复测值为准，不再重算。
        </p>
        <form @submit.prevent="submitRemeasure">
          <div class="form-grid">
            <label class="form-item">
              <span>复测布方面积（必填，缺失一律退回）</span>
              <input v-model="remeasureForm.复测布方面积" placeholder="如：25㎡" />
            </label>
            <label class="form-item">
              <span>复测人</span>
              <input v-model="remeasureForm.复测人" />
            </label>
            <label class="form-item">
              <span>复测日期</span>
              <input v-model="remeasureForm.复测日期" type="date" />
            </label>
            <label class="form-item">
              <span>备注</span>
              <input v-model="remeasureForm.备注" placeholder="复测情况说明" />
            </label>
          </div>
          <p v-if="remeasureError" class="error-text">{{ remeasureError }}</p>
          <div class="modal-foot">
            <button class="btn" type="button" @click="cancelRemeasure">取消</button>
            <button class="btn primary" type="submit">保存复测记录</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  availableActions,
  canRemeasure,
  downloadEntries,
  getEntry,
  listEntries,
  listRemeasures,
  moduleMeta,
  recordRemeasure,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const meta = moduleMeta('trench')
const columns = ["探方编号", "所属发掘区", "布方面积", "起始层位", "现场负责人", "开工日期", "最大深度", "探方状态"]
const statuses = ["待布方", "发掘中", "已停掘", "已回填"]
const stats = [{"label": "发掘中探方", "value": 0}, {"label": "待布方探方", "value": 0}, {"label": "累计布方面积", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const detailRow = ref<EntryRow | null>(null)
const detailRemeasures = ref<EntryRow[]>([])
const remeasureTarget = ref<EntryRow | null>(null)
const remeasureForm = ref({ 复测布方面积: '', 复测人: '', 复测日期: '', 备注: '' })
const remeasureError = ref('')

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '探方登记入口尚未接入审批流'
}

function rowActions(row: EntryRow) {
  return availableActions(meta.key, row)
}

function canRemeasureRow(row: EntryRow) {
  return canRemeasure(row)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function openDetail(row: EntryRow) {
  detailRow.value = getEntry(meta.key, Number(row.id))
  detailRemeasures.value = detailRow.value
    ? listRemeasures(String(detailRow.value['探方编号'] ?? ''))
    : []
}

function closeDetail() {
  detailRow.value = null
  detailRemeasures.value = []
}

function openRemeasure(row: EntryRow) {
  remeasureTarget.value = row
  remeasureForm.value = {
    复测布方面积: '',
    复测人: store.operator,
    复测日期: new Date().toISOString().slice(0, 10),
    备注: '',
  }
  remeasureError.value = ''
}

function cancelRemeasure() {
  remeasureTarget.value = null
  remeasureError.value = ''
}

function submitRemeasure() {
  if (!remeasureTarget.value) {
    return
  }
  const result = recordRemeasure({
    探方编号: String(remeasureTarget.value['探方编号'] ?? ''),
    ...remeasureForm.value,
  })
  if (!result.ok) {
    remeasureError.value = result.message
    return
  }
  remeasureTarget.value = null
  errorMessage.value = ''
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '探方登记列表读取失败'
  }
}

onMounted(reload)
</script>
