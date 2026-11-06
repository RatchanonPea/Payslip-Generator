export type FieldKey =
  | 'emp_id' | 'full_name' | 'id_card_no' | 'birth_date' | 'department' | 'bank_account_no'
  | 'base_salary' | 'ot_pay' | 'allowances' | 'bonus' | 'deductions_other'
  | 'sso_amount' | 'tax_amount'

export interface FieldDef {
  key: FieldKey
  label: string
  required: boolean
  numeric: boolean
  hint: string
  aliases: string[]
}

export type RawRow = Record<string, unknown>
export type Mapping = Partial<Record<FieldKey, string>>

export interface Employee {
  row: number
  emp_id: string
  full_name: string
  id_card_no: string
  birth_date: string // YYYY-MM-DD
  department: string
  bank_account_no: string
  base_salary: number
  ot_pay: number
  allowances: number
  bonus: number
  deductions_other: number
  sso_amount?: number
  tax_amount?: number
}

export interface Issue {
  row: number
  emp_id: string
  field: FieldKey | 'row'
  level: 'error' | 'warning'
  message: string
}

export interface Computed extends Employee {
  gross: number
  sso: number
  tax: number
  totalDeductions: number
  net: number
  taxAuto: boolean
  ssoAuto: boolean
}

export type PasswordFormat = 'YYYY-MM-DD' | 'YYYYMMDD' | 'DDMMYYYY'
export type BankCode = 'KBANK' | 'SCB' | 'BBL' | 'TTB'
export type PaperKey = '9x5.5' | '9x4' | '9x3.66' | '8.5x5.5' | 'A5L' | 'A4'
export type TaxMode = 'progressive' | 'flat' | 'none'
export type SsoBase = 'base' | 'gross'

export interface Settings {
  companyName: string
  companyTaxId: string
  companyAddress: string
  ssoAccountNo: string
  ssoBranch: string
  period: string // YYYY-MM
  payDate: string // YYYY-MM-DD
  paperSize: PaperKey
  signatureDataUrl: string // image of the authorised signer, '' = leave the line blank
  signerName: string
  ssoEnabled: boolean
  ssoBase: SsoBase // wage used for SSO: base salary only, or total income
  taxMode: TaxMode
  flatTaxRate: number // used when taxMode = 'flat' (0.03 = 3%)
  expenseRate: number // standard expense deduction rate (0.5 = 50%)
  expenseCap: number // cap on the expense deduction per year
  ssoRate: number
  ssoMinBase: number
  ssoMaxBase: number
  ssoMaxContribution: number
  personalAllowance: number
  monthsPaid: number
  passwordFormat: PasswordFormat
  companyBankAccount: string
}
