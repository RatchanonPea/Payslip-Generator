import type { FieldDef, Settings } from './types'

export const FIELDS: FieldDef[] = [
  { key: 'emp_id', label: 'รหัสพนักงาน', required: true, numeric: false, hint: 'EMP-001', aliases: ['emp_id', 'empid', 'employee id', 'employee_id', 'รหัสพนักงาน', 'รหัส'] },
  { key: 'full_name', label: 'ชื่อ-นามสกุล', required: true, numeric: false, hint: 'สมชาย ใจดี', aliases: ['full_name', 'fullname', 'name', 'ชื่อ-นามสกุล', 'ชื่อนามสกุล', 'ชื่อ'] },
  { key: 'id_card_no', label: 'เลขบัตรประชาชน', required: true, numeric: false, hint: '13 หลัก', aliases: ['id_card_no', 'id_card', 'national_id', 'citizen_id', 'เลขบัตรประชาชน', 'เลขบัตร'] },
  { key: 'birth_date', label: 'วันเกิด', required: false /* true when PDF password is enabled */, numeric: false, hint: 'YYYY-MM-DD', aliases: ['birth_date', 'birthday', 'dob', 'วันเกิด', 'วันเดือนปีเกิด'] },
  { key: 'department', label: 'แผนก', required: false, numeric: false, hint: 'IT, HR', aliases: ['department', 'dept', 'แผนก', 'สังกัด'] },
  { key: 'bank_account_no', label: 'เลขบัญชีธนาคาร', required: true, numeric: false, hint: 'ไม่ใส่ขีด', aliases: ['bank_account_no', 'bank_account', 'account_no', 'เลขบัญชี', 'เลขที่บัญชี'] },
  { key: 'base_salary', label: 'เงินเดือนพื้นฐาน', required: true, numeric: true, hint: 'ตัวเลข', aliases: ['base_salary', 'salary', 'basic_salary', 'เงินเดือน', 'เงินเดือนพื้นฐาน'] },
  { key: 'ot_pay', label: 'ค่าล่วงเวลา (OT)', required: false, numeric: true, hint: 'ตัวเลข', aliases: ['ot_pay', 'ot', 'overtime', 'ค่าล่วงเวลา', 'โอที'] },
  { key: 'allowances', label: 'เบี้ยเลี้ยง/ค่าตำแหน่ง', required: false, numeric: true, hint: 'ตัวเลข', aliases: ['allowances', 'allowance', 'เบี้ยเลี้ยง', 'ค่าตำแหน่ง', 'คอมมิชชัน'] },
  { key: 'bonus', label: 'โบนัส', required: false, numeric: true, hint: 'ตัวเลข', aliases: ['bonus', 'โบนัส', 'เงินพิเศษ'] },
  { key: 'deductions_other', label: 'เงินหักอื่น ๆ', required: false, numeric: true, hint: 'ขาด ลา สาย เงินกู้', aliases: ['deductions_other', 'deductions', 'deduction', 'เงินหัก', 'หักอื่น'] },
  { key: 'sso_amount', label: 'ประกันสังคม (ถ้ามี)', required: false, numeric: true, hint: 'เว้นว่าง = คำนวณให้', aliases: ['sso_amount', 'sso', 'social_security', 'ประกันสังคม'] },
  { key: 'tax_amount', label: 'ภาษีหัก ณ ที่จ่าย (ถ้ามี)', required: false, numeric: true, hint: 'เว้นว่าง = คำนวณให้', aliases: ['tax_amount', 'tax', 'withholding_tax', 'ภาษี', 'ภาษีหัก ณ ที่จ่าย'] },
]

export function defaultSettings(): Settings {
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return {
    companyName: '', companyTaxId: '', companyAddress: '', ssoAccountNo: '', ssoBranch: '000000',
    period: ym, payDate: `${ym}-28`, paperSize: '9x5.5', signatureDataUrl: '', signerName: '', ssoEnabled: true, ssoBase: 'base',
    taxMode: 'progressive', flatTaxRate: 0.03, expenseRate: 0.5, expenseCap: 100000, ssoRate: 0.05, ssoMinBase: 1650, ssoMaxBase: 15000,
    ssoMaxContribution: 750, personalAllowance: 60000, monthsPaid: 12,
    passwordFormat: 'YYYY-MM-DD', companyBankAccount: '',
  }
}
