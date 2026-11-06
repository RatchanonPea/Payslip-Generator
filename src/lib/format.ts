import type { PasswordFormat, Settings } from './types'

export const baht = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const MONTHS_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return `${MONTHS_TH[m - 1] ?? ''} ${y + 543}`
}

export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y) return ''
  return `${d} ${MONTHS_TH[m - 1]} ${y + 543}`
}

export function pdfPassword(birthIso: string, fmt: PasswordFormat): string {
  const [y, m, d] = birthIso.split('-')
  if (fmt === 'YYYYMMDD') return `${y}${m}${d}`
  if (fmt === 'DDMMYYYY') return `${d}${m}${y}`
  return birthIso
}

/** File-system safe name. Employee data must never create path traversal inside the ZIP. */
export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').trim() || 'unnamed'
}

export function splitName(full: string): { prefix: string; first: string; last: string } {
  const m = full.trim().match(/^(นางสาว|นาย|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|Mr\.?|Mrs\.?|Ms\.?|Miss)\s*/i)
  const prefix = m ? m[1] : ''
  const rest = full.trim().slice(m ? m[0].length : 0)
  const parts = rest.split(/\s+/)
  return { prefix, first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}

/** CSV cells starting with = + - @ would execute as formulas in Excel. */
export function csvCell(v: string | number): string {
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = "'" + s
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function download(name: string, data: Blob | Uint8Array | string, type = 'application/octet-stream') {
  const part: BlobPart = typeof data === 'string' ? data : data instanceof Blob ? data : (data as Uint8Array<ArrayBuffer>)
  const blob = data instanceof Blob ? data : new Blob([part], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export function companyLine(s: Settings): string {
  return s.companyName || 'ชื่อบริษัท'
}
