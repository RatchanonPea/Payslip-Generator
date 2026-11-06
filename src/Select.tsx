import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface Opt { value: string; label: string }

interface Pos { top?: number; bottom?: number; left?: number; right?: number; minWidth: number; maxWidth: number; maxHeight: number; above: boolean }

const CLOSE_MS = 120

/**
 * Own dropdown (the browser's <select> list can't be animated or styled):
 * glass popover that fades / scales in and out, chevron flips up while open,
 * keyboard: ↑ ↓ Home End Enter Space Esc Tab. The list is portalled to <body> so no card can clip it.
 */
export function Select(props: {
  id?: string; value: string; options: Opt[]; onChange: (v: string) => void
  ariaLabel?: string; disabled?: boolean; variant?: 'field' | 'pill'; placeholder?: string
}) {
  const { id, value, options, onChange, ariaLabel, disabled, variant = 'field', placeholder = 'เลือก' } = props
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const [active, setActive] = useState(0)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const listId = useId()

  const selected = Math.max(0, options.findIndex((o) => o.value === value))
  const current = options.find((o) => o.value === value)

  const place = () => {
    const el = btn.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vh = window.innerHeight
    const vw = window.innerWidth
    const below = vh - r.bottom - 12
    const above = r.top - 12
    const wantH = Math.min(300, options.length * 40 + 12)
    const up = below < wantH && above > below
    const alignRight = r.left > vw / 2 && r.width < 260
    setPos({
      ...(up ? { bottom: vh - r.top + 6 } : { top: r.bottom + 6 }),
      ...(alignRight ? { right: vw - r.right } : { left: r.left }),
      minWidth: r.width,
      maxWidth: Math.max(r.width, (alignRight ? r.right : vw - r.left) - 12),
      maxHeight: Math.max(120, Math.min(320, (up ? above : below))),
      above: up,
    })
  }

  const openList = () => {
    if (disabled) return
    window.clearTimeout(timer.current)
    place()
    setActive(selected)
    setMounted(true)
    setOpen(true)
  }
  const closeList = () => {
    if (!open) return
    setOpen(false)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMounted(false), CLOSE_MS)
  }
  const choose = (i: number) => {
    const o = options[i]
    if (o) onChange(o.value)
    closeList()
    btn.current?.focus()
  }

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // stay attached to the button while the page scrolls, close if the window changes size
  useEffect(() => {
    if (!mounted) return
    const onScroll = () => place()
    const onResize = () => closeList()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize) }
  })

  // click / tap outside closes
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (btn.current?.contains(t) || pop.current?.contains(t)) return
      closeList()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  })

  useEffect(() => {
    if (open) pop.current?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open, mounted])

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); openList() }
      return
    }
    // keys handled while open must not reach page-level shortcuts (e.g. Esc closing the viewer)
    if (k === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setActive((a) => Math.min(a + 1, options.length - 1)) }
    else if (k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setActive((a) => Math.max(a - 1, 0)) }
    else if (k === 'Home') { e.preventDefault(); e.stopPropagation(); setActive(0) }
    else if (k === 'End') { e.preventDefault(); e.stopPropagation(); setActive(options.length - 1) }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); choose(active) }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeList() }
    else if (k === 'Tab') closeList()
  }

  return (
    <>
      <button
        ref={btn} id={id} type="button" disabled={disabled}
        className={`sel-btn ${variant === 'pill' ? 'pill' : ''} ${open ? 'open' : ''}`}
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={ariaLabel}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        title={current?.label}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={onKey}
      >
        <span key={current?.value ?? '_'} className={`sel-label swap ${current ? '' : 'ph'}`}>{current ? current.label : placeholder}</span>
        <svg className="sel-chev" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.5 5.25 7 8.75l3.5-3.5" />
        </svg>
      </button>
      {mounted && pos && createPortal(
        <div
          ref={pop} id={listId} role="listbox" aria-label={ariaLabel}
          className={`sel-pop ${open ? 'in' : 'closing'} ${pos.above ? 'above' : ''}`}
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right, minWidth: pos.minWidth, maxWidth: pos.maxWidth, maxHeight: pos.maxHeight }}
        >
          {options.map((o, i) => (
            <div
              key={o.value + i} id={`${listId}-${i}`} role="option" aria-selected={o.value === value}
              className={`sel-opt ${i === active ? 'act' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span>{o.label}</span>
              {o.value === value && (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.8 7.4 5.6 10.2 11.2 4.2" /></svg>
              )}
            </div>
          ))}
          {/* real content, not padding: scrollable boxes don't always honour bottom padding at the end of the scroll */}
          <div className="sel-end" aria-hidden="true" />
        </div>,
        document.body,
      )}
    </>
  )
}
