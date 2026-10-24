import { ItemInput, moneyInput, parseMoney, today } from './domain'

export function purchaseDefaults(existing?: Partial<ItemInput>, prefill?: Partial<ItemInput>) {
  const source = existing || prefill
  return { amount: moneyInput(source?.purchaseAmount ?? null), date: source ? source.purchaseDate || '' : today(), blankPriceAsZero: !source }
}
export const purchaseAmount = (amount: string, blankPriceAsZero = false) => parseMoney(amount) ?? (blankPriceAsZero ? 0 : null)
