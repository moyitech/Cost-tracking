import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, createApiClient, Session, Transport } from '../src/api-client'
import { apiEvent, apiItem, ApiItem } from '../src/api-types'
import { metrics, retiredItemFields } from '../src/domain'

const session = (token: string): Session => ({ access_token: token, refresh_token: `refresh-${token}`, user: { id: 'u', display_name: '我' } })
test('concurrent expired requests share refresh and preserve write headers/body', async () => {
  let current: Session | null = session('old'); let refreshes = 0
  const payload = { name: '物品' }; const successful: { data: unknown; headers: unknown }[] = []
  const transport: Transport = async (path, method, data, headers) => {
    if (path === '/auth/refresh') { refreshes++; await new Promise(resolve => setTimeout(resolve, 10)); return { status: 200, data: session('new') } }
    if (headers?.Authorization === 'Bearer old') return { status: 401, data: {} }
    successful.push({ data, headers }); return { status: 200, data: { id: 'item' } }
  }
  const api = createApiClient(transport, () => current, next => { current = next }, async () => { throw new Error('unexpected login') })
  const results = await Promise.all(Array.from({ length: 5 }, () => api.request('/items', 'POST', payload, { 'If-Match': '"1"', 'Idempotency-Key': 'same' })))
  assert.equal(refreshes, 1); assert.equal(results.length, 5)
  for (const call of successful) { assert.deepEqual(call.data, payload); assert.equal((call.headers as any)['Idempotency-Key'], 'same'); assert.equal((call.headers as any)['If-Match'], '"1"') }
})
test('failed refresh due to outage retains session and does not silently log in again', async () => {
  let current: Session | null = session('old'); let logins = 0
  const api = createApiClient(async path => ({ status: path === '/auth/refresh' ? 503 : 401, data: {} }), () => current, value => { current = value }, async () => { logins++; return session('new') })
  await assert.rejects(api.request('/me'), (e: ApiError) => e.status === 503)
  assert.equal(current?.access_token, 'old'); assert.equal(logins, 0)
})
test('concurrent first requests share login, while conflicts never retry writes', async () => {
  let current: Session | null = null; let logins = 0; let writes = 0
  const api = createApiClient(async () => { writes++; return { status: 409, data: { error: { code: 'REVISION_CONFLICT', message: '已更新' } } } }, () => current, value => { current = value }, async () => { logins++; await new Promise(resolve => setTimeout(resolve, 5)); return session('new') })
  const results = await Promise.allSettled([api.request('/item', 'PATCH'), api.request('/item', 'PATCH')])
  assert.equal(logins, 1); assert.equal(writes, 2); assert.ok(results.every(r => r.status === 'rejected'))
})
test('server metrics preserve unknown, negative, decimal yuan and file IDs', () => {
  const raw = { brand: null, model: null, location: null, channel: null, serial: null, warranty: null, note: null, id: 'i', space_id: 's', name: '耳机', category: '数码', image_file_id: 'image', attachment_file_ids: ['receipt'], purchase_amount_cents: null, purchase_date: null, status: 'sold', disposal_date: '2026-10-19', recovery_amount_cents: 100, deleted_at: null, revision: 2, expenses: [], metrics: { as_of_date: '2026-10-19', extra_cents: 0, known_investment_cents: 0, total_investment_cents: null, holding_days: 1, net_cost_cents: -100, current_daily_yuan: null, actual_daily_yuan: '-1.00' } } as ApiItem
  const item = apiItem(raw)
  assert.equal(item.purchaseAmount, null); assert.equal(item.imageFileId, 'image'); assert.equal(item.attachments?.[0].fileId, 'receipt')
  assert.equal(metrics(item).daily, -100); assert.equal(metrics(item).total, null)
  assert.equal(item.image, '')
  for (const key of retiredItemFields) assert.equal(key in item, false)
})

test('old item metadata does not reappear in history while expense categories remain', () => {
  const audit = apiEvent({ id: 'event', item_id: 'item', title: '编辑物品资料', occurred_on: null, recorded_at: '2026-10-23T00:00:00Z', actor: { id: 'me', display_name: '我' }, changes: [{ field: 'brand', before: null, after: '旧品牌' }, { field: 'note', before: null, after: '保留备注' }, { field: 'expenses', before: [], after: [{ category: '维修' }] }] })
  assert.ok(!audit.detail?.includes('旧品牌'))
  assert.ok(audit.detail?.includes('保留备注'))
  assert.ok(audit.detail?.includes('维修'))
})
