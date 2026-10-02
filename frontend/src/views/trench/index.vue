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
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
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
        <header class="modal-head">
          <h3>探方详情 · {{ detailRow['探方编号'] }}</h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>
        <table class="detail-table">
          <tbody>
            <tr v-for="field in detailFields" :key="field">
              <th>{{ field }}</th>
              <td>{{ detailRow[field] || '—' }}</td>
            </tr>
            <tr>
              <th>当前状态</th>
              <td>{{ detailRow.status }}</td>
            </tr>
          </tbody>
        </table>
        <p class="hint-text">清单与详情读的是同一条登记数据，布方面积以现场复测值为准，不再重算。</p>
      </div>
    </div>

    <div v-if="backfillRow" class="modal-mask" @click.self="closeBackfill">
      <div class="modal-card">
        <header class="modal-head">
          <h3>办理回填 · {{ backfillRow['探方编号'] }}</h3>
          <button class="link" type="button" @click="closeBackfill">关闭</button>
        </header>
        <table class="detail-table">
          <tbody>
            <tr>
              <th>台账布方面积</th>
              <td>{{ backfillRow['布方面积'] || '（缺失）' }}</td>
            </tr>
            <tr>
              <th>起始层位</th>
              <td>{{ backfillRow['起始层位'] || '（缺失）' }}</td>
            </tr>
          </tbody>
        </table>
        <label class="form-item">
          <span>现场复测布方面积（与台账不一致时填写，留空沿用台账）</span>
          <input v-model="remeasuredArea" placeholder="如：96㎡" />
        </label>
        <label class="form-item">
          <span>复测人</span>
          <input v-model="remeasuredBy" placeholder="现场复测经手人" />
        </label>
        <p class="hint-text">
          回填前核对布方面积与起始层位，面积缺失一律退回、不保存；复测值一经留存不再重算，回填收尾后自动转探方验收待办。
        </p>
        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="closeBackfill">取消</button>
          <button class="btn primary" type="button" @click="confirmBackfill">确认回填</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  backfillTrench,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('trench')
const columns = ["探方编号", "所属发掘区", "布方面积", "起始层位", "现场负责人", "开工日期", "最大深度", "探方状态"]
const actions = ["提交布方", "登记停掘", "办理回填"]
const statuses = ["待布方", "发掘中", "已停掘", "已回填"]
const stats = [{"label": "发掘中探方", "value": 0}, {"label": "待布方探方", "value": 0}, {"label": "累计布方面积", "value": 0}]
// 详情页在登记字段之外，追加本次复测留存的字段（有才显示）。
const remeasureFields = ["台账布方面积", "复测布方面积", "复测人", "复测日期", "复测记录"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const detailRow = ref<EntryRow | null>(null)
const backfillRow = ref<EntryRow | null>(null)
const remeasuredArea = ref('')
const remeasuredBy = ref('')

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const detailFields = computed(() => {
  const row = detailRow.value
  if (!row) {
    return []
  }
  const extras = remeasureFields.filter((field) => String(row[field] ?? '') !== '')
  return [...meta.fields, ...extras]
})

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

function openDetail(row: EntryRow) {
  detailRow.value = row
}

function closeDetail() {
  detailRow.value = null
}

function openBackfill(row: EntryRow) {
  remeasuredArea.value = ''
  remeasuredBy.value = ''
  backfillRow.value = row
}

function closeBackfill() {
  backfillRow.value = null
}

function confirmBackfill() {
  const row = backfillRow.value
  if (!row) {
    return
  }
  const result = backfillTrench(Number(row.id), {
    remeasuredArea: remeasuredArea.value,
    remeasuredBy: remeasuredBy.value,
  })
  closeBackfill()
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  if (action === '办理回填' && String(row.status) === '已停掘') {
    openBackfill(row)
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
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
