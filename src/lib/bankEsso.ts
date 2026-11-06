import type { BankCode, Computed, Settings } from './types'
import { csvCell, splitName } from './format'
import { ssoWage } from './calc'

export interface OutFile { name: string; data: string | Uint8Array }

export const BANKS: Array<{ code: BankCode; label: string; ext: 'csv' | 'txt' }> = [
  { code: 'KBANK', label: 'กสิกรไทย (KBank)', ext: 'csv' },
  { code: 'SCB', label: 'ไทยพาณิชย์ (SCB)', ext: 'txt' },
  { code: 'BBL', label: 'กรุงเทพ (BBL)', ext: 'txt' },
  { code: 'TTB', label: 'ทีเอ็มบีธนชาต (ttb)', ext: 'csv' },
]

const ymd = (iso: string) => iso.replace(/-/g, '')

/**
 * Generic bulk-transfer layouts. Each bank gives corporate customers its own exact
 * template, so these must be checked against the bank's current spec before upload.
 */
export function bankFile(code: BankCode, emps: Computed[], s: Settings): OutFile {
  const meta = BANKS.find((b) => b.code === code)!
  const total = emps.reduce((a, e) => a + e.net, 0)
  const amt = (n: number) => n.toFixed(2)
  const pay = ymd(s.payDate)
  let body: string
  if (code === 'KBANK') {
    body = ['seq,account_no,account_name,amount,pay_date,reference']
      .concat(emps.map((e, i) => [i + 1, e.bank_account_no, e.full_name, amt(e.net), pay, e.emp_id].map(csvCell).join(','))).join('\r\n')
  } else if (code === 'TTB') {
    body = ['account_no,account_name,amount,pay_date,memo']
      .concat(emps.map((e) => [e.bank_account_no, e.full_name, amt(e.net), pay, `SALARY ${s.period}`].map(csvCell).join(','))).join('\r\n')
  } else if (code === 'SCB') {
    const head = ['H', s.companyBankAccount, pay, String(emps.length), amt(total)].join('|')
    body = [head].concat(emps.map((e, i) => ['D', String(i + 1), e.bank_account_no, amt(e.net), e.emp_id].join('|'))).join('\r\n')
  } else {
    const head = ['HDR', s.companyBankAccount, pay, String(emps.length).padStart(6, '0'), amt(total).replace('.', '').padStart(15, '0')].join('')
    body = [head].concat(emps.map((e, i) =>
      ['DTL', String(i + 1).padStart(6, '0'), e.bank_account_no.padEnd(12, ' '), amt(e.net).replace('.', '').padStart(13, '0')].join(''))).join('\r\n')
  }
  return { name: `bank-payin-${code}.${meta.ext}`, data: meta.ext === 'csv' ? '﻿' + body + '\r\n' : body + '\r\n' }
}

/** Thai code page TIS-620 / Windows-874: U+0E01..U+0E5B -> 0xA1..0xFB. */
export function encodeTis620(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const cp = s.charCodeAt(i)
    out[i] = cp < 0x80 ? cp : cp >= 0x0e01 && cp <= 0x0e5b ? cp - 0x0d60 : 0x3f
  }
  return out
}

const padR = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s.padEnd(n, ' '))
const padL = (s: string, n: number) => s.slice(-n).padStart(n, '0')
const beDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}${m}${String(+y + 543).slice(-2)}` }

/**
 * Fixed-width monthly contribution file (สปส.1-10 style). Layout follows the common
 * header/detail structure but must be verified against the SSO e-Service spec before filing.
 */
export function essoFile(emps: Computed[], s: Settings): OutFile {
  const [py, pm] = s.period.split('-')
  const wage = (e: Computed) => Math.min(Math.max(ssoWage(e, s), s.ssoMinBase), s.ssoMaxBase)
  const cents = (n: number) => String(Math.round(n * 100))
  const totalWage = emps.reduce((a, e) => a + wage(e), 0)
  const totalSso = emps.reduce((a, e) => a + e.sso, 0)
  const lines = [
    '1' + padL(s.ssoAccountNo.replace(/\D/g, ''), 10) + padL(s.ssoBranch.replace(/\D/g, ''), 6) + beDate(s.payDate) +
      pm + String(+py + 543).slice(-2) + padR(s.companyName, 45) + padL(String(Math.round(s.ssoRate * 10000)), 4) +
      padL(String(emps.length), 6) + padL(cents(totalWage), 15) + padL(cents(totalSso), 14),
  ]
  for (const e of emps) {
    const n = splitName(e.full_name)
    lines.push('2' + padL(e.id_card_no, 13) + padR(n.prefix, 10) + padR(n.first, 30) + padR(n.last, 30) + padL(cents(wage(e)), 14) + padL(cents(e.sso), 12))
  }
  return { name: `esso-${s.period}.txt`, data: encodeTis620(lines.join('\r\n') + '\r\n') }
}

// Field widths used by essoFile above. Keep in sync: the viewer reads the file back with these.
const ESSO_HEAD = [1, 10, 6, 6, 2, 2, 45, 4, 6, 15, 14]
const ESSO_DETAIL = [1, 13, 10, 30, 30, 14, 12]

const cut = (line: string, widths: number[]) => {
  let at = 0
  return widths.map((w) => { const v = line.slice(at, at + w); at += w; return v })
}

export interface EssoView {
  head: { account: string; branch: string; payDate: string; month: string; year: string; company: string; ratePct: string; count: number; totalWage: number; totalSso: number }
  rows: Array<{ id: string; prefix: string; first: string; last: string; wage: number; sso: number }>
}

/** Reads an esso file's text back into labelled fields for display. */
export function parseEsso(text: string): EssoView | null {
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length === 0 || !lines[0].startsWith('1')) return null
  const h = cut(lines[0], ESSO_HEAD)
  const baht = (v: string) => (Number(v) || 0) / 100
  return {
    head: {
      account: h[1], branch: h[2], payDate: `${h[3].slice(0, 2)}/${h[3].slice(2, 4)}/${h[3].slice(4, 6)}`, month: h[4], year: h[5],
      company: h[6].trim(), ratePct: ((Number(h[7]) || 0) / 100).toFixed(2), count: Number(h[8]) || 0, totalWage: baht(h[9]), totalSso: baht(h[10]),
    },
    rows: lines.slice(1).filter((l) => l.startsWith('2')).map((l) => {
      const d = cut(l, ESSO_DETAIL)
      return { id: d[1], prefix: d[2].trim(), first: d[3].trim(), last: d[4].trim(), wage: baht(d[5]), sso: baht(d[6]) }
    }),
  }
}
