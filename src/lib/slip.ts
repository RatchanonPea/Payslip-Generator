import type { Computed, Settings } from './types'
import { baht, companyLine, dateLabel, periodLabel /*, pdfPassword */ } from './format'
import { line, newPage, pagesToPdf, text } from './pdfDoc'
import { PAPERS } from './paper'

const sigCache = new Map<string, HTMLCanvasElement>()

/**
 * drawSlip is synchronous, so the signature must be decoded beforehand.
 * Blank margins (transparent or near-white) are cropped so the ink fills the signature box.
 */
export async function loadSignature(dataUrl: string): Promise<void> {
  if (!dataUrl || sigCache.has(dataUrl)) return
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  // SVG may report 0 size; photos can be huge. Work on a bounded raster either way.
  const nw = img.naturalWidth || 600
  const nh = img.naturalHeight || 300
  const k = Math.min(1, 1200 / Math.max(nw, nh))
  const w = Math.max(1, Math.round(nw * k))
  const h = Math.max(1, Math.round(nh * k))
  const src = document.createElement('canvas')
  src.width = w
  src.height = h
  const sc = src.getContext('2d', { willReadFrequently: true })!
  sc.drawImage(img, 0, 0, w, h)
  const imgData = sc.getImageData(0, 0, w, h)
  const d = imgData.data
  // Opaque image (JPG, photo, flat PNG): knock out the paper colour so only the ink remains.
  let opaque = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] > 250) opaque++
  if (opaque / (w * h) > 0.98) {
    const hist = new Uint32Array(256)
    for (let i = 0; i < d.length; i += 4) hist[Math.min(d[i], d[i + 1], d[i + 2])]++
    let acc = 0, bg = 255
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= w * h * 0.8) { bg = v; break } } // paper = bulk of pixels
    const span = Math.max(40, bg * 0.5)
    for (let i = 0; i < d.length; i += 4) {
      const m = Math.min(d[i], d[i + 1], d[i + 2])
      d[i + 3] = Math.max(0, Math.min(255, Math.round(((bg - 12 - m) / span) * 255)))
    }
    sc.putImageData(imgData, 0, 0)
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const ink = d[i + 3] > 40 && (d[i] < 225 || d[i + 1] < 225 || d[i + 2] < 225)
      if (ink) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
  }
  if (x1 < 0) { sigCache.set(dataUrl, src); return } // nothing detected, keep as is
  const cw = x1 - x0 + 1
  const ch = y1 - y0 + 1
  const out = document.createElement('canvas')
  out.width = cw
  out.height = ch
  out.getContext('2d')!.drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch)
  sigCache.set(dataUrl, out)
}

/** Processed (background removed, cropped) signature as a PNG data URL, for UI thumbnails. */
export const signaturePreview = (dataUrl: string) => sigCache.get(dataUrl)?.toDataURL('image/png') ?? ''

const INK = '#10252b'
const MUTED = '#5b7377'
const RULE = '#7d9391'

/**
 * Layout follows the continuous-form payslip: header, info strip, income | deductions | totals,
 * signature line. Everything is placed from the page size so any paper stock works.
 * A4 (tall) pages carry the slip on the top half, leaving room to cut the sheet in two.
 */
export function drawSlip(e: Computed, s: Settings) {
  const paper = PAPERS[s.paperSize] ?? PAPERS['9x5.5']
  const p = newPage(paper.mmW, paper.mmH)
  const { c, w } = p
  const H = Math.min(p.h, Math.round(w * 0.66)) // slip height; tall sheets use the upper part
  const f = Math.min(w / 1530, Math.max(H / 935, 0.75)) // font scale
  const sz = (n: number) => Math.round(n * f)
  const m = Math.round(w * 0.035)
  const L = m
  const R = w - m
  const W = R - L

  // outer frame
  c.strokeStyle = INK
  c.lineWidth = 2
  c.strokeRect(L, Math.round(H * 0.03), W, Math.round(H * 0.94))
  const top = Math.round(H * 0.03)
  const bottom = Math.round(H * 0.97)
  const pad = sz(18)

  // header
  text(p, companyLine(s), L + pad, top + sz(46), { size: sz(36), weight: 600, max: W * 0.55 })
  if (s.companyAddress) {
    // wrap instead of squeezing: break at spaces, keep the glyphs at their natural width
    const aSize = sz(20)
    const aMax = W * 0.58
    c.font = `400 ${aSize}px "IBM Plex Sans Thai", sans-serif`
    const lines: string[] = []
    // the box usually starts with the company name, which is already the header: skip that line
    const addrLines = s.companyAddress.split('\n').map((l) => l.trim()).filter(Boolean)
    if (addrLines[0] === s.companyName.trim()) addrLines.shift()
    // every line the user typed stays its own line; only a line too long for the header is wrapped (at spaces)
    for (const para of addrLines) {
      let cur = ''
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = cur ? `${cur} ${word}` : word
        if (cur && c.measureText(next).width > aMax) { lines.push(cur); cur = word } else cur = next
      }
      if (cur) lines.push(cur)
    }
    const maxLines = H < 700 ? 2 : 3
    const shown = lines.slice(0, maxLines)
    if (lines.length > maxLines) shown[maxLines - 1] += ' …'
    shown.forEach((ln, i) => text(p, ln, L + pad, top + sz(76) + i * Math.round(aSize * 1.3), { size: aSize, color: MUTED, max: aMax }))
  }
  text(p, 'ใบแจ้งเงินเดือน (PAY SLIP)', R - pad, top + sz(46), { size: sz(32), weight: 600, align: 'right' })
  text(p, `ประจำงวด (PERIOD)  ${periodLabel(s.period)}`, R - pad, top + sz(78), { size: sz(22), color: MUTED, align: 'right' })

  // info strip
  const infoY = top + Math.round((bottom - top) * 0.2)
  line(p, L, infoY, R, infoY, INK, 1.5)
  const rowH = sz(40)
  const midX = L + W * 0.55
  const info = (label: string, value: string, x: number, y: number, max: number) => {
    text(p, label, x, y, { size: sz(20), color: MUTED })
    text(p, value || '-', x + sz(200), y, { size: sz(24), weight: 500, max })
  }
  info('แผนก / Dep.', e.department, L + pad, infoY + rowH, midX - L - sz(260))
  info('ชื่อสกุล / Emp.', e.full_name, L + pad, infoY + rowH * 2, midX - L - sz(260))
  info('รหัส / ID', e.emp_id, midX, infoY + rowH, R - midX - sz(220))
  info('วันที่จ่าย / Date', dateLabel(s.payDate), midX, infoY + rowH * 2, R - midX - sz(220))

  // table
  const tTop = infoY + rowH * 2 + sz(22)
  line(p, L, tTop, R, tTop, INK, 1.5)
  const sigH = Math.round((bottom - top) * 0.16)
  const tBottom = bottom - sigH
  const colA = L + W * 0.38 // income | deduction
  const colB = L + W * 0.69 // deduction | totals
  line(p, colA, tTop, colA, tBottom, INK, 1.5)
  line(p, colB, tTop, colB, tBottom, INK, 1.5)
  line(p, L, tBottom, R, tBottom, INK, 1.5)

  const heads = sz(36)
  text(p, 'รายได้ (Income)', (L + colA) / 2, tTop + sz(26), { size: sz(22), weight: 600, align: 'center' })
  text(p, 'รายการหัก (Deduction)', (colA + colB) / 2, tTop + sz(26), { size: sz(22), weight: 600, align: 'center' })
  line(p, L, tTop + heads, colB, tTop + heads, RULE, 1)

  const income: Array<[string, number]> = [
    ['เงินเดือน (Salary)', e.base_salary],
    ['ค่าล่วงเวลา (OT)', e.ot_pay],
    ['เบี้ยเลี้ยง/ค่าตำแหน่ง (Allowance)', e.allowances],
    ['โบนัส (Bonus)', e.bonus],
  ]
  const deduct: Array<[string, number]> = [
    ['ภาษีหัก ณ ที่จ่าย (Tax)', e.tax],
    ['ประกันสังคม (SSO)', e.sso],
    ['หักอื่น ๆ (Other)', e.deductions_other],
  ]
  const n = income.length
  const bodyTop = tTop + heads
  const step = Math.min(sz(52), (tBottom - bodyTop - sz(6)) / n)
  const cell = (rows: Array<[string, number]>, x1: number, x2: number) => {
    rows.forEach(([label, v], i) => {
      const y = bodyTop + step * (i + 1) - Math.round(step * 0.28)
      text(p, label, x1 + pad * 0.6, y, { size: sz(21), max: (x2 - x1) * 0.62 })
      text(p, v ? baht(v) : '-', x2 - pad * 0.6, y, { size: sz(23), align: 'right' })
    })
  }
  cell(income, L, colA)
  cell(deduct, colA, colB)

  // totals column
  const tw = R - colB
  const box = (label: string, value: string, yTop: number, h: number, strong = false) => {
    if (strong) {
      c.strokeStyle = INK
      c.lineWidth = 2.5
      c.strokeRect(colB + pad, yTop, tw - pad * 2, h)
    }
    text(p, label, colB + pad * 1.4, yTop + h * 0.38, { size: sz(21), color: MUTED, max: tw - pad * 3 })
    text(p, value, R - pad * 1.4, yTop + h * 0.84, { size: sz(strong ? 40 : 28), weight: strong ? 600 : 500, align: 'right', max: tw - pad * 3 })
  }
  const bh = (tBottom - tTop - pad) / 3
  box('รวมเงินได้ (Total Income)', baht(e.gross), tTop + sz(6), bh - sz(10))
  box('รวมเงินหัก (Total Deduction)', baht(e.totalDeductions), tTop + bh, bh - sz(10))
  box('เงินได้สุทธิ (Net Income)', baht(e.net), tTop + bh * 2 - sz(4), bh - sz(2), true)

  // signature strip
  const sy = bottom - Math.round(sigH * 0.32)
  text(p, 'ลายเซ็น / Sign', L + pad, sy, { size: sz(20), color: MUTED })
  line(p, L + pad + sz(170), sy + sz(4), L + W * 0.45, sy + sz(4), RULE, 1)
  text(p, 'วันที่ / Date', L + W * 0.55, sy, { size: sz(20), color: MUTED })
  line(p, L + W * 0.55 + sz(130), sy + sz(4), R - pad, sy + sz(4), RULE, 1)

  const sig = sigCache.get(s.signatureDataUrl)
  if (sig) {
    const x1 = L + pad + sz(170)
    const x2 = L + W * 0.45
    const maxH = sigH * 0.7
    const k = Math.min((x2 - x1) / sig.width, maxH / sig.height)
    const dw = sig.width * k
    const dh = sig.height * k
    c.drawImage(sig, x1 + (x2 - x1 - dw) / 2, sy + sz(6) - dh, dw, dh) // sits on the line
    if (s.signerName) text(p, `(${s.signerName})`, (x1 + x2) / 2, sy + sz(30), { size: sz(17), color: MUTED, align: 'center', max: x2 - x1 })
    text(p, dateLabel(s.payDate), (L + W * 0.55 + sz(130) + R - pad) / 2, sy - sz(2), { size: sz(21), align: 'center' })
  }

  // A4: show where to cut
  if (p.h - H > sz(80)) {
    line(p, 0, H, w, H, '#9bb0ae', 2, [10, 12])
  }
  return p
}

export function slipPdf(e: Computed, s: Settings): Uint8Array {
  const { mmW, mmH } = PAPERS[s.paperSize] ?? PAPERS['9x5.5']
  const orientation = mmW > mmH ? 'l' : 'p'
  // password disabled for now: { mmW, mmH, orientation, password: pdfPassword(e.birth_date, s.passwordFormat) }
  return pagesToPdf([drawSlip(e, s)], { mmW, mmH, orientation })
}
