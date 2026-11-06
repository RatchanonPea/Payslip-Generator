import type { Computed, Settings } from './types'
import { baht, dateLabel, /* pdfPassword, */ periodLabel } from './format'
import { line, newPage, pagesToPdf, text, type Page } from './pdfDoc'

const A4P = { mmW: 210, mmH: 297 }

interface Col { title: string; x: number; align?: CanvasTextAlign }

/** Paginated summary table (used for ภ.ง.ด.1 and ภ.ง.ด.1ก). */
function summaryPages(title: string, subtitle: string, s: Settings, rows: string[][], cols: Col[], totals: string[]): Page[] {
  const pages: Page[] = []
  const rowH = 44
  let p!: Page
  let y = 0
  const header = () => {
    p = newPage(A4P.mmW, A4P.mmH)
    pages.push(p)
    text(p, title, 80, 120, { size: 40, weight: 600 })
    text(p, subtitle, 80, 165, { size: 24, color: '#5b7377' })
    text(p, `ผู้จ่ายเงิน: ${s.companyName || '-'}   เลขประจำตัวผู้เสียภาษี: ${s.companyTaxId || '-'}`, 80, 205, { size: 22 })
    y = 270
    p.c.fillStyle = '#12353a'
    p.c.fillRect(60, y - 34, p.w - 120, 50)
    cols.forEach((c) => text(p, c.title, c.x, y, { size: 21, weight: 600, color: '#fff', align: c.align }))
    y += 52
  }
  header()
  rows.forEach((r, i) => {
    if (y > p.h - 160) header()
    if (i % 2 === 1) { p.c.fillStyle = '#f1f5f4'; p.c.fillRect(60, y - 31, p.w - 120, rowH) }
    r.forEach((cell, k) => text(p, cell, cols[k].x, y, { size: 20, align: cols[k].align, max: cols[k].align === 'right' ? 220 : 300 }))
    y += rowH
  })
  line(p!, 60, y - 24, p!.w - 60, y - 24, '#12353a', 2)
  y += 14
  totals.forEach((cell, k) => cell && text(p!, cell, cols[k].x, y, { size: 21, weight: 600, align: cols[k].align }))
  return pages
}

export function pnd1Pages(emps: Computed[], s: Settings): Page[] {
  const cols: Col[] = [
    { title: 'ลำดับ', x: 80 }, { title: 'เลขประจำตัวประชาชน', x: 170 }, { title: 'ชื่อ-นามสกุล', x: 420 },
    { title: 'เงินได้ที่จ่าย', x: 1130, align: 'right' }, { title: 'ภาษีที่หักและนำส่ง', x: 1380, align: 'right' },
  ]
  const rows = emps.map((e, i) => [String(i + 1), e.id_card_no, e.full_name, baht(e.gross), baht(e.tax)])
  const tg = emps.reduce((a, e) => a + e.gross, 0)
  const tt = emps.reduce((a, e) => a + e.tax, 0)
  return summaryPages('ใบแนบ ภ.ง.ด.1', `เงินได้ตามมาตรา 40(1) เดือนภาษี ${periodLabel(s.period)} (${emps.length} ราย)`, s, rows, cols, ['', '', 'รวม', baht(tg), baht(tt)])
}

export function pnd1aPages(emps: Computed[], s: Settings): Page[] {
  const k = s.monthsPaid
  const cols: Col[] = [
    { title: 'ลำดับ', x: 80 }, { title: 'เลขประจำตัวประชาชน', x: 170 }, { title: 'ชื่อ-นามสกุล', x: 420 },
    { title: 'เงินได้ทั้งปี', x: 1130, align: 'right' }, { title: 'ภาษีทั้งปี', x: 1380, align: 'right' },
  ]
  const rows = emps.map((e, i) => [String(i + 1), e.id_card_no, e.full_name, baht(e.gross * k), baht(e.tax * k)])
  const tg = emps.reduce((a, e) => a + e.gross * k, 0)
  const tt = emps.reduce((a, e) => a + e.tax * k, 0)
  return summaryPages('ใบแนบ ภ.ง.ด.1ก', `สรุปเงินได้ทั้งปี (ประมาณการจากงวดนี้ × ${k} เดือน) ${emps.length} ราย`, s, rows, cols, ['', '', 'รวม', baht(tg), baht(tt)])
}

/** หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ), locked with the employee's password. */
export function wht50bisPage(e: Computed, s: Settings, seq: number): Page {
  const k = s.monthsPaid
  const p = newPage(A4P.mmW, A4P.mmH)
  const m = 90
  const r = p.w - m
  text(p, 'หนังสือรับรองการหักภาษี ณ ที่จ่าย', p.w / 2, 140, { size: 40, weight: 600, align: 'center' })
  text(p, 'ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร', p.w / 2, 185, { size: 24, color: '#5b7377', align: 'center' })
  text(p, `เล่มที่ - เลขที่ ${String(seq).padStart(5, '0')}`, r, 140, { size: 22, align: 'right' })

  let y = 270
  const box = (head: string, rows: Array<[string, string]>) => {
    p.c.fillStyle = '#12353a'
    p.c.fillRect(m, y - 34, r - m, 50)
    text(p, head, m + 16, y, { size: 22, weight: 600, color: '#fff' })
    y += 56
    rows.forEach(([a, b]) => {
      text(p, a, m + 16, y, { size: 21, color: '#5b7377' })
      text(p, b, m + 330, y, { size: 23, weight: 500, max: r - m - 350 })
      y += 46
    })
    y += 30
  }
  box('ผู้มีหน้าที่หักภาษี ณ ที่จ่าย', [
    ['ชื่อ', s.companyName || '-'], ['เลขประจำตัวผู้เสียภาษี', s.companyTaxId || '-'], ['ที่อยู่', s.companyAddress || '-'],
  ])
  box('ผู้ถูกหักภาษี ณ ที่จ่าย', [
    ['ชื่อ', e.full_name], ['เลขประจำตัวประชาชน', e.id_card_no], ['รหัสพนักงาน', e.emp_id],
  ])

  const cols = [m + 16, r - 520, r - 16]
  p.c.fillStyle = '#12353a'
  p.c.fillRect(m, y - 34, r - m, 50)
  text(p, 'ประเภทเงินได้พึงประเมินที่จ่าย', cols[0], y, { size: 21, weight: 600, color: '#fff' })
  text(p, 'จำนวนเงินที่จ่าย', cols[1] + 200, y, { size: 21, weight: 600, color: '#fff', align: 'right' })
  text(p, 'ภาษีที่หักและนำส่ง', cols[2], y, { size: 21, weight: 600, color: '#fff', align: 'right' })
  y += 58
  text(p, '1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40(1)', cols[0], y, { size: 21, max: 560 })
  text(p, baht(e.gross * k), cols[1] + 200, y, { size: 22, align: 'right' })
  text(p, baht(e.tax * k), cols[2], y, { size: 22, align: 'right' })
  y += 22
  line(p, m, y, r, y, '#c5d3d1', 1.5)
  y += 44
  text(p, 'รวมเงินที่จ่ายและภาษีที่หักนำส่ง', cols[0], y, { size: 22, weight: 600 })
  text(p, baht(e.gross * k), cols[1] + 200, y, { size: 23, weight: 600, align: 'right' })
  text(p, baht(e.tax * k), cols[2], y, { size: 23, weight: 600, align: 'right' })
  y += 56
  text(p, `เงินสะสมจ่ายเข้ากองทุนประกันสังคม  ${baht(e.sso * k)} บาท`, m + 16, y, { size: 22 })
  y += 46
  text(p, 'ผู้จ่ายเงิน  ☑ หัก ณ ที่จ่าย', m + 16, y, { size: 22 })

  y += 140
  text(p, 'ขอรับรองว่าข้อความที่ระบุไว้ข้างต้นถูกต้องตรงกับความจริงทุกประการ', p.w / 2, y, { size: 21, align: 'center' })
  y += 120
  line(p, r - 420, y, r, y, '#10252b', 1.5)
  text(p, 'ผู้จ่ายเงิน', r - 210, y + 40, { size: 21, align: 'center' })
  text(p, `วันที่ ${dateLabel(s.payDate)}`, r - 210, y + 80, { size: 21, align: 'center' })
  text(p, `ตัวเลขทั้งปีเป็นประมาณการ: งวด ${periodLabel(s.period)} × ${k} เดือน`, m, p.h - 90, { size: 18, color: '#8aa0a2' })
  // password disabled for now: { ...A4P, password: pdfPassword(e.birth_date, s.passwordFormat) }
  return p
}

export const pnd1Pdf = (emps: Computed[], s: Settings) => pagesToPdf(pnd1Pages(emps, s), A4P)
export const pnd1aPdf = (emps: Computed[], s: Settings) => pagesToPdf(pnd1aPages(emps, s), A4P)
export const wht50bisPdf = (e: Computed, s: Settings, seq: number) => pagesToPdf([wht50bisPage(e, s, seq)], A4P)

export const A4_RATIO = A4P.mmW / A4P.mmH
