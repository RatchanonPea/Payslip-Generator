import { jsPDF } from 'jspdf'

export const FONT = '"IBM Plex Sans Thai", sans-serif'

export async function ensureFonts() {
  await Promise.all([
    document.fonts.load(`400 20px ${FONT}`, 'กขค ABC 123'),
    document.fonts.load(`500 20px ${FONT}`, 'กขค ABC 123'),
    document.fonts.load(`600 20px ${FONT}`, 'กขค ABC 123'),
  ])
}

export interface Page {
  c: CanvasRenderingContext2D
  w: number
  h: number
  canvas: HTMLCanvasElement
}

/** Pages are drawn on a canvas so the browser does Thai shaping, then embedded as images. */
export function newPage(mmW: number, mmH: number, dpi = 170): Page {
  const w = Math.round((mmW / 25.4) * dpi)
  const h = Math.round((mmH / 25.4) * dpi)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const c = canvas.getContext('2d')!
  c.fillStyle = '#ffffff'
  c.fillRect(0, 0, w, h)
  c.textBaseline = 'alphabetic'
  return { c, w, h, canvas }
}

export interface PdfOptions { password?: string; orientation?: 'p' | 'l'; mmW: number; mmH: number }

export function pagesToPdf(pages: Page[], o: PdfOptions): Uint8Array {
  const doc = new jsPDF({
    orientation: o.orientation ?? 'p',
    unit: 'mm',
    format: [o.mmW, o.mmH],
    compress: true,
    ...(o.password
      ? { encryption: { userPassword: o.password, ownerPassword: crypto.randomUUID(), userPermissions: ['print'] as ('print')[] } }
      : {}),
  })
  pages.forEach((p, i) => {
    if (i > 0) doc.addPage([o.mmW, o.mmH], o.orientation ?? 'p')
    doc.addImage(p.canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, o.mmW, o.mmH, undefined, 'FAST')
    p.canvas.width = 0 // release memory
  })
  return new Uint8Array(doc.output('arraybuffer'))
}

export const font = (px: number, weight: 400 | 500 | 600 = 400) => `${weight} ${px}px ${FONT}`

export function text(
  p: Page, s: string, x: number, y: number,
  o: { size?: number; weight?: 400 | 500 | 600; color?: string; align?: CanvasTextAlign; max?: number } = {},
) {
  p.c.font = font(o.size ?? 22, o.weight ?? 400)
  p.c.fillStyle = o.color ?? '#10252b'
  p.c.textAlign = o.align ?? 'left'
  if (o.max) p.c.fillText(s, x, y, o.max)
  else p.c.fillText(s, x, y)
}

export function line(p: Page, x1: number, y1: number, x2: number, y2: number, color = '#10252b', width = 1.5, dash: number[] = []) {
  p.c.strokeStyle = color
  p.c.lineWidth = width
  p.c.setLineDash(dash)
  p.c.beginPath()
  p.c.moveTo(x1, y1)
  p.c.lineTo(x2, y2)
  p.c.stroke()
  p.c.setLineDash([])
}
