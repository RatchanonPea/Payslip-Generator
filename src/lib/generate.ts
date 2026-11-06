import JSZip from 'jszip'
import type { BankCode, Computed, Settings } from './types'
import { safeName } from './format'
import { ensureFonts } from './pdfDoc'
import { loadSignature, slipPdf } from './slip'
import { pnd1Pdf, pnd1aPdf, wht50bisPdf } from './taxReports'
import { bankFile, essoFile } from './bankEsso'

export type Progress = (done: number, total: number) => void
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

function uniqueName(used: Set<string>, base: string, ext: string): string {
  let n = safeName(base)
  let i = 2
  while (used.has(`${n}.${ext}`)) n = `${safeName(base)}_${i++}`
  used.add(`${n}.${ext}`)
  return `${n}.${ext}`
}

export async function payslipZip(emps: Computed[], s: Settings, onProgress: Progress): Promise<Blob> {
  await ensureFonts()
  await loadSignature(s.signatureDataUrl)
  const zip = new JSZip()
  const used = new Set<string>()
  for (let i = 0; i < emps.length; i++) {
    const e = emps[i]
    zip.file(uniqueName(used, `payslip_${s.period}_${e.emp_id}`, 'pdf'), slipPdf(e, s))
    onProgress(i + 1, emps.length)
    await tick()
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' })
}

export async function taxZip(emps: Computed[], s: Settings, onProgress: Progress): Promise<Blob> {
  await ensureFonts()
  const zip = new JSZip()
  const total = emps.length + 2
  zip.file(`PND1_${s.period}.pdf`, pnd1Pdf(emps, s))
  onProgress(1, total)
  await tick()
  zip.file(`PND1A_${s.period.slice(0, 4)}.pdf`, pnd1aPdf(emps, s))
  onProgress(2, total)
  const used = new Set<string>()
  for (let i = 0; i < emps.length; i++) {
    zip.file(`50bis/${uniqueName(used, `50bis_${emps[i].emp_id}`, 'pdf')}`, wht50bisPdf(emps[i], s, i + 1))
    onProgress(i + 3, total)
    await tick()
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' })
}

export const makeBank = (code: BankCode, emps: Computed[], s: Settings) => bankFile(code, emps, s)
export const makeEsso = (emps: Computed[], s: Settings) => essoFile(emps, s)
