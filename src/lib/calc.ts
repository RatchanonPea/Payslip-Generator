import type { Computed, Employee, Settings } from './types'

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function calcSso(wage: number, s: Settings): number {
  if (!s.ssoEnabled) return 0
  const base = Math.min(Math.max(wage, s.ssoMinBase), s.ssoMaxBase)
  return Math.min(round2(base * s.ssoRate), s.ssoMaxContribution)
}

// Thai progressive brackets (net taxable income per year)
const BRACKETS: Array<[number, number]> = [
  [150000, 0], [300000, 0.05], [500000, 0.1], [750000, 0.15], [1000000, 0.2],
  [2000000, 0.25], [5000000, 0.3], [Infinity, 0.35],
]

export function annualTax(net: number): number {
  let tax = 0
  let prev = 0
  for (const [cap, rate] of BRACKETS) {
    if (net > prev) tax += (Math.min(net, cap) - prev) * rate
    prev = cap
  }
  return tax
}

/** Wage SSO is computed on: base salary or total income, per settings. */
export const ssoWage = (e: { base_salary: number; gross: number }, s: Settings) =>
  s.ssoBase === 'gross' ? e.gross : e.base_salary

/**
 * Withholding per settings.
 * progressive: project this month x12, apply expenses + allowances, divide back by 12.
 * flat: monthly income x flat rate. none: 0.
 */
export function calcWithholding(monthlyIncome: number, monthlySso: number, s: Settings): number {
  if (s.taxMode === 'none') return 0
  if (s.taxMode === 'flat') return round2(monthlyIncome * s.flatTaxRate)
  const annual = monthlyIncome * 12
  const expense = Math.min(annual * s.expenseRate, s.expenseCap)
  const net = Math.max(0, annual - expense - s.personalAllowance - monthlySso * 12)
  return round2(annualTax(net) / 12)
}

export function compute(e: Employee, s: Settings): Computed {
  const gross = round2(e.base_salary + e.ot_pay + e.allowances + e.bonus)
  const ssoAuto = e.sso_amount === undefined
  const sso = ssoAuto ? calcSso(ssoWage({ base_salary: e.base_salary, gross }, s), s) : e.sso_amount!
  const taxAuto = e.tax_amount === undefined
  const tax = taxAuto ? calcWithholding(gross, sso, s) : e.tax_amount!
  const totalDeductions = round2(sso + tax + e.deductions_other)
  return { ...e, gross, sso, tax, totalDeductions, net: round2(gross - totalDeductions), ssoAuto, taxAuto }
}
