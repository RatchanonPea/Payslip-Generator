import type { PaperKey } from './types'

const IN = 25.4

export interface Paper { label: string; mmW: number; mmH: number; note?: string }

/** Common payslip stock. Sizes in mm. Landscape forms are width > height. */
export const PAPERS: Record<PaperKey, Paper> = {
  '9x5.5': { label: '9 × 5.5 นิ้ว (กระดาษต่อเนื่อง Dot Matrix)', mmW: 9 * IN, mmH: 5.5 * IN },
  '9x4': { label: '9 × 4 นิ้ว', mmW: 9 * IN, mmH: 4 * IN },
  '9x3.66': { label: '9 × 3.66 นิ้ว', mmW: 9 * IN, mmH: 3.66 * IN },
  '8.5x5.5': { label: '8.5 × 5.5 นิ้ว', mmW: 8.5 * IN, mmH: 5.5 * IN },
  A5L: { label: 'A5 แนวนอน (210 × 148 มม.)', mmW: 210, mmH: 148 },
  A4: { label: 'A4 (สลิปอยู่ครึ่งบนของหน้า ตัดแบ่งครึ่งได้)', mmW: 210, mmH: 297 },
}

export const PAPER_KEYS = Object.keys(PAPERS) as PaperKey[]
