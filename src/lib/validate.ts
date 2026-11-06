import { FIELDS } from './fields'
import type { Employee, FieldKey, Issue, Mapping, RawRow } from './types'

export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v == null) return null
  const s = String(v).replace(/[,฿\s]/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

export function normalizeDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(+v)) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  let y: number, mo: number, d: number
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3] }
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3] }
  else return null
  if (y > 2400) y -= 543 // Buddhist era
  const dt = new Date(y, mo - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Thai national ID checksum (mod 11). */
export function thaiIdChecksumOk(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += +id[i] * (13 - i)
  return (11 - (sum % 11)) % 10 === +id[12]
}

export function buildEmployees(rows: RawRow[], mapping: Mapping): { employees: Employee[]; issues: Issue[] } {
  const issues: Issue[] = []
  const employees: Employee[] = []
  const seen = new Map<string, number>()

  rows.forEach((raw, i) => {
    const row = i + 2 // header is row 1
    const get = (k: FieldKey) => (mapping[k] ? raw[mapping[k]!] : undefined)
    const text = (k: FieldKey) => String(get(k) ?? '').trim()
    const empId = text('emp_id')
    const add = (field: FieldKey | 'row', level: Issue['level'], message: string) =>
      issues.push({ row, emp_id: empId, field, level, message })

    if (Object.values(raw).every((v) => String(v ?? '').trim() === '')) return

    for (const f of FIELDS) {
      if (f.required && !f.numeric && text(f.key) === '') add(f.key, 'error', `${f.label}ว่าง`)
    }

    const idCard = text('id_card_no').replace(/[\s-]/g, '')
    if (idCard !== '') {
      if (!/^\d{13}$/.test(idCard)) add('id_card_no', 'error', 'เลขบัตรประชาชนไม่ครบ 13 หลัก')
      else if (!thaiIdChecksumOk(idCard)) add('id_card_no', 'warning', 'เลขบัตรประชาชนไม่ผ่านการตรวจหลักสุดท้าย')
    }

    let birth = ''
    const rawBirth = get('birth_date')
    if (rawBirth instanceof Date || text('birth_date') !== '') {
      const b = normalizeDate(rawBirth)
      if (!b) add('birth_date', 'error', 'วันเกิดไม่อยู่ในรูปแบบ YYYY-MM-DD')
      else birth = b
    }

    const bank = text('bank_account_no').replace(/[\s-]/g, '')
    if (bank !== '' && !/^\d{10,12}$/.test(bank)) add('bank_account_no', 'warning', 'เลขบัญชีควรเป็นตัวเลข 10-12 หลัก')

    const nums: Partial<Record<FieldKey, number>> = {}
    for (const f of FIELDS.filter((x) => x.numeric)) {
      const n = parseNumber(get(f.key))
      if (n === null) {
        if (f.key === 'base_salary') add('base_salary', 'error', 'เงินเดือนว่าง')
        continue
      }
      if (Number.isNaN(n)) add(f.key, 'error', `${f.label}ไม่ใช่ตัวเลข`)
      else if (n < 0) add(f.key, 'error', `${f.label}ติดลบ`)
      else nums[f.key] = n
    }

    if (empId !== '') {
      if (seen.has(empId)) add('emp_id', 'error', `รหัสพนักงานซ้ำกับแถว ${seen.get(empId)}`)
      else seen.set(empId, row)
    }

    employees.push({
      row, emp_id: empId, full_name: text('full_name'), id_card_no: idCard, birth_date: birth,
      department: text('department'), bank_account_no: bank,
      base_salary: nums.base_salary ?? 0, ot_pay: nums.ot_pay ?? 0, allowances: nums.allowances ?? 0,
      bonus: nums.bonus ?? 0, deductions_other: nums.deductions_other ?? 0,
      sso_amount: nums.sso_amount, tax_amount: nums.tax_amount,
    })
  })
  return { employees, issues }
}
