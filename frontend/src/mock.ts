import { assets } from './assets'
import { Item, Ledger, today } from './domain'

function daysAgo(days: number) { return new Date(Date.parse(`${today()}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10) }
function seed(id: string, name: string, category: string, amount: number | null, days: number, image: string, extra: Partial<Item> = {}): Item {
  const date = daysAgo(days - 1)
  return { id, name, category, purchaseAmount: amount, purchaseDate: date, image, spaceId: 'personal', brand: '', model: '', status: 'active', disposalDate: null, recoveryAmount: null, location: '', channel: '', serial: '', warranty: '', note: '', expenses: [], history: [{ id: `${id}-purchase`, title: '初始购入建档', occurredOn: date, recordedAt: `${today()}T08:00:00Z`, actor: '我', detail: '示例档案' }], deleted: false, revision: 1, ...extra }
}
export function initialLedger(): Ledger {
  return { version: 1, spaces: [
    { id: 'personal', name: '我的个人空间', kind: 'personal', role: 'admin', members: [{ id: 'me', name: '我', role: 'admin' }] },
    { id: 'family', name: '温暖的家', kind: 'family', role: 'admin', members: [{ id: 'me', name: '我', role: 'admin' }, { id: 'partner', name: '家人', role: 'editor' }] },
    { id: 'parents', name: '爸妈的家', kind: 'family', role: 'viewer', members: [{ id: 'parent', name: '家人', role: 'admin' }, { id: 'me', name: '我', role: 'viewer' }] },
  ], items: [
    seed('macbook', 'Apple MacBook Pro 14″', '数码', 1999900, 450, assets['home-photo0'].src, { brand: 'Apple', model: 'M3 Max · 64G', location: '书房', channel: 'Apple 官方旗舰店' }),
    seed('sony', 'Sony A7M4 机身', '数码摄影', 1460000, 385, assets['home-photo1'].src, { brand: 'SONY', model: 'ILCE-7M4', location: '防潮箱 A-02', channel: '京东自营旗舰店', serial: 'S01-4928172', warranty: '保修期限待核对', expenses: [{ id: 'sony-maintenance', category: '保养', amount: 80000, date: daysAgo(60), note: 'CMOS 清洁与蒙皮更换' }], history: [
      { id: 'sony-e', title: 'CMOS 清洁与蒙皮更换', occurredOn: daysAgo(60), recordedAt: `${today()}T08:00:00Z`, actor: '我', detail: '保养 · ¥800.00' },
      { id: 'sony-s', title: '状态变更 · 设为主力', occurredOn: daysAgo(300), recordedAt: `${today()}T08:00:00Z`, actor: '我', detail: '在用' },
      { id: 'sony-p', title: '初始购入建档 · 官方旗舰店', occurredOn: daysAgo(384), recordedAt: `${today()}T08:00:00Z`, actor: '我', detail: '¥14,600.00' },
    ] }),
    seed('dyson', 'Dyson V12 无绳吸尘器', '生活家电', 399000, 620, assets['home-photo2'].src, { brand: 'Dyson', location: '储物间' }),
    seed('iphone', 'iPhone 13 Pro 256G', '数码', 831900, 900, assets['home-photo3'].src, { brand: 'Apple', model: '256G', status: 'sold', disposalDate: daysAgo(180), recoveryAmount: 320000 }),
    seed('family-dyson', '客厅吸尘器', '生活家电', 299900, 180, assets['home-photo2'].src, { spaceId: 'family', location: '客厅' }),
    seed('parents-phone', '家人的手机', '数码', null, 120, assets['home-photo3'].src, { spaceId: 'parents' }),
  ] }
}
