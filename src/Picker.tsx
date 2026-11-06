import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { dateLabel, periodLabel } from './lib/format'

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const POP_W = 304
const CLOSE_MS = 120
const BE = 543 // Buddhist era offset

const pad = (n: number) => String(n).padStart(2, '0')
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate()

function parse(v: string) {
  const mm = v.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/)
  const now = new Date()
  if (!mm) return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate(), ok: false }
  return { y: +mm[1], m: +mm[2] - 1, d: mm[3] ? +mm[3] : 1, ok: true }
}

interface Pos { top?: number; bottom?: number; left: number; above: boolean; maxHeight: number }
type View = 'days' | 'months' | 'years'

/**
 * Thai date / month picker (Buddhist-era years) in the same glass style as Select.
 * mode 'date' stores YYYY-MM-DD, mode 'month' stores YYYY-MM. Popover is portalled to <body>.
 */
export function DatePicker(props: { id?: string; mode: 'date' | 'month'; value: string; onChange: (v: string) => void; ariaLabel?: string }) {
  const { id, mode, value, onChange, ariaLabel } = props
  const sel = parse(value)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const [view, setView] = useState<View>('days')
  const [cur, setCur] = useState({ y: sel.y, m: sel.m })
  const [fd, setFd] = useState(sel.d) // day that has keyboard focus
  const [yb, setYb] = useState(sel.y - 4) // first year of the year grid
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const dialogId = useId()
  const today = new Date()

  const place = () => {
    const el = btn.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vh = window.innerHeight
    const vw = window.innerWidth
    const below = vh - r.bottom - 12
    const above = r.top - 12
    const up = below < 360 && above > below
    setPos({
      ...(up ? { bottom: vh - r.top + 6 } : { top: r.bottom + 6 }),
      left: Math.max(8, Math.min(r.left, vw - POP_W - 8)),
      maxHeight: Math.max(240, up ? above : below),
      above: up,
    })
  }

  const openIt = () => {
    window.clearTimeout(timer.current)
    place()
    setCur({ y: sel.y, m: sel.m })
    setFd(sel.d)
    setYb(sel.y - 4)
    setView(mode === 'month' ? 'months' : 'days')
    setMounted(true)
    setOpen(true)
  }
  const closeIt = (refocus = false) => {
    if (!open) return
    setOpen(false)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMounted(false), CLOSE_MS)
    if (refocus) btn.current?.focus()
  }

  useEffect(() => () => window.clearTimeout(timer.current), [])

  useEffect(() => {
    if (!mounted) return
    const onScroll = () => place()
    const onResize = () => closeIt()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize) }
  })

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (btn.current?.contains(t) || pop.current?.contains(t)) return
      closeIt()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  })

  // keyboard focus follows the chosen day / month / year
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => pop.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(id)
  }, [open, mounted, view, cur.y, cur.m, fd])

  const finish = (v: string) => { onChange(v); closeIt(true) }
  const pickDay = (d: number) => finish(`${cur.y}-${pad(cur.m + 1)}-${pad(d)}`)
  const pickMonth = (mi: number) => {
    if (mode === 'month') finish(`${cur.y}-${pad(mi + 1)}`)
    else { setCur({ y: cur.y, m: mi }); setFd(Math.min(fd, daysIn(cur.y, mi))); setView('days') }
  }
  const pickYear = (y: number) => { setCur({ ...cur, y }); setView('months') }
  const goToday = () => finish(mode === 'date' ? `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}` : `${today.getFullYear()}-${pad(today.getMonth() + 1)}`)

  const shift = (dir: number) => {
    if (view === 'days') {
      const dt = new Date(cur.y, cur.m + dir, 1)
      setCur({ y: dt.getFullYear(), m: dt.getMonth() })
      setFd((d) => Math.min(d, daysIn(dt.getFullYear(), dt.getMonth())))
    } else if (view === 'months') setCur({ ...cur, y: cur.y + dir })
    else setYb(yb + dir * 12)
  }

  const onPopKey = (e: React.KeyboardEvent) => {
    const k = e.key
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeIt(true); return }
    if (view !== 'days') return
    const step = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : k === 'ArrowUp' ? -7 : k === 'ArrowDown' ? 7 : 0
    if (step) {
      e.preventDefault(); e.stopPropagation()
      const dt = new Date(cur.y, cur.m, fd + step)
      setCur({ y: dt.getFullYear(), m: dt.getMonth() })
      setFd(dt.getDate())
    } else if (k === 'PageUp' || k === 'PageDown') {
      e.preventDefault(); e.stopPropagation()
      shift(k === 'PageUp' ? -1 : 1)
    }
  }

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (open) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeIt() } return }
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openIt() }
  }

  const label = !sel.ok ? 'เลือก' : mode === 'date' ? dateLabel(value) : periodLabel(value)
  const title = view === 'days' ? `${MONTHS[cur.m]} ${cur.y + BE}` : view === 'months' ? `${cur.y + BE}` : `${yb + BE} – ${yb + 11 + BE}`
  const goUp = () => { if (view === 'days') setView('months'); else if (view === 'months') { setYb(cur.y - 4); setView('years') } }

  const lead = new Date(cur.y, cur.m, 1).getDay()
  const total = daysIn(cur.y, cur.m)

  return (
    <>
      <button
        ref={btn} id={id} type="button" className={`sel-btn pk-btn ${open ? 'open' : ''}`}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId} aria-label={ariaLabel}
        onClick={() => (open ? closeIt() : openIt())} onKeyDown={onTriggerKey}
      >
        <span className="sel-label">{label}</span>
        <svg className="pk-ico" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="3.5" width="13" height="12" rx="3" /><path d="M2.5 7.5h13M6 2v3M12 2v3" />
        </svg>
      </button>

      {mounted && pos && createPortal(
        <div
          ref={pop} id={dialogId} role="dialog" aria-label={mode === 'date' ? 'เลือกวันที่' : 'เลือกเดือน'}
          className={`sel-pop pk-pop ${open ? 'in' : 'closing'} ${pos.above ? 'above' : ''}`}
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, maxHeight: pos.maxHeight }}
          onKeyDown={onPopKey}
        >
          <div className="pk-head">
            <button type="button" className="pk-nav" onClick={() => shift(-1)} aria-label="ก่อนหน้า">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8.8 3 4.8 7l4 4" /></svg>
            </button>
            <button type="button" className="pk-title" onClick={goUp} disabled={view === 'years'} aria-live="polite">{title}</button>
            <button type="button" className="pk-nav" onClick={() => shift(1)} aria-label="ถัดไป">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5.2 3l4 4-4 4" /></svg>
            </button>
          </div>

          <div className="pk-view" key={view}>
            {view === 'days' && (
              <>
                <div className="pk-dow" aria-hidden="true">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
                <div className="pk-grid" role="grid">
                  {Array.from({ length: lead }, (_, i) => <span key={`e${i}`} />)}
                  {Array.from({ length: total }, (_, i) => {
                    const d = i + 1
                    const isSel = sel.ok && sel.y === cur.y && sel.m === cur.m && sel.d === d
                    const isToday = today.getFullYear() === cur.y && today.getMonth() === cur.m && today.getDate() === d
                    return (
                      <button
                        key={d} type="button" role="gridcell" aria-selected={isSel}
                        className={`pk-day ${isSel ? 'sel' : ''} ${isToday ? 'today' : ''}`}
                        tabIndex={d === fd ? 0 : -1} data-autofocus={d === fd ? '' : undefined}
                        onClick={() => pickDay(d)}
                      >{d}</button>
                    )
                  })}
                </div>
              </>
            )}
            {view === 'months' && (
              <div className="pk-cells">
                {MONTHS_SHORT.map((n, i) => {
                  const isSel = sel.ok && sel.y === cur.y && sel.m === i
                  return (
                    <button key={n} type="button" className={`pk-cell ${isSel ? 'sel' : ''} ${today.getFullYear() === cur.y && today.getMonth() === i ? 'today' : ''}`}
                      data-autofocus={(mode === 'month' ? isSel || (!sel.ok && i === today.getMonth()) : i === cur.m) ? '' : undefined}
                      onClick={() => pickMonth(i)}>{n}</button>
                  )
                })}
              </div>
            )}
            {view === 'years' && (
              <div className="pk-cells">
                {Array.from({ length: 12 }, (_, i) => yb + i).map((y) => (
                  <button key={y} type="button" className={`pk-cell ${sel.ok && sel.y === y ? 'sel' : ''} ${today.getFullYear() === y ? 'today' : ''}`}
                    data-autofocus={y === cur.y ? '' : undefined} onClick={() => pickYear(y)}>{y + BE}</button>
                ))}
              </div>
            )}
          </div>

          <div className="pk-foot">
            <button type="button" className="link" onClick={goToday}>{mode === 'date' ? 'วันนี้' : 'เดือนนี้'}</button>
            <button type="button" className="link" onClick={() => closeIt(true)}>ปิด</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
