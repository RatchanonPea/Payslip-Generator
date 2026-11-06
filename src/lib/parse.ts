import * as XLSX from 'xlsx'
import type { RawRow } from './types'

export interface ParsedFile { headers: string[]; rows: RawRow[]; encoding: string; sheet: string }

const MAX_BYTES = 25 * 1024 * 1024

function decodeText(buf: ArrayBuffer): { text: string; encoding: string } {
  let bytes = new Uint8Array(buf)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3)
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' }
  } catch {
    return { text: new TextDecoder('windows-874').decode(bytes), encoding: 'TIS-620' }
  }
}

/** Parses entirely in memory. Nothing is uploaded or persisted. */
export async function parseFile(file: File): Promise<ParsedFile> {
  if (file.size > MAX_BYTES) throw new Error('ไฟล์ใหญ่เกิน 25 MB')
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!ext || !['xlsx', 'xls', 'csv'].includes(ext)) throw new Error('รองรับเฉพาะไฟล์ .xlsx .xls และ .csv')
  const buf = await file.arrayBuffer()
  let wb: XLSX.WorkBook
  let encoding = 'Excel'
  if (ext === 'csv') {
    const d = decodeText(buf)
    encoding = d.encoding
    wb = XLSX.read(d.text, { type: 'string', raw: true })
  } else {
    wb = XLSX.read(buf, { type: 'array', cellDates: true })
  }
  const sheet = wb.SheetNames[0]
  if (!sheet) throw new Error('ไม่พบชีตในไฟล์')
  const rows = XLSX.utils.sheet_to_json<RawRow>(wb.Sheets[sheet], { defval: '' })
  if (rows.length === 0) throw new Error('ไฟล์ไม่มีข้อมูลพนักงาน')
  const headers = Object.keys(rows[0])
  return { headers, rows, encoding, sheet }
}

export function templateCsv(): string {
  const head = 'emp_id,full_name,id_card_no,birth_date,department,bank_account_no,base_salary,ot_pay,allowances,bonus,deductions_other'
  const r1 = 'EMP-001,สมชาย ใจดี,1101700230673,1990-05-14,IT,0123456789,35000,2500,1500,0,0'
  const r2 = 'EMP-002,สมหญิง รักงาน,3100600123454,1988-11-02,HR,9876543210,28000,0,1000,5000,500'
  return '﻿' + [head, r1, r2].join('\r\n') + '\r\n'
}
