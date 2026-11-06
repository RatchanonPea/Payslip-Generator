import { useEffect, useId, useState } from 'react'

const R = 24
const C = 2 * Math.PI * R

/**
 * Floating glass "back to top" button. The neon ring around it fills as you scroll down the page.
 * A glint sweeps across it every 4.5 s while idle, and again whenever the pointer is over it.
 */
export function ScrollTop({ hidden = false }: { hidden?: boolean }) {
  const gid = useId()
  const [y, setY] = useState(0)
  const [p, setP] = useState(0)

  useEffect(() => {
    let raf = 0
    const calc = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setY(window.scrollY)
      setP(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0)
    }
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(calc) }
    calc()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    // the page grows and shrinks (steps fold, tables fill in), which changes the progress too
    const ro = new ResizeObserver(onScroll)
    ro.observe(document.body)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      ro.disconnect()
    }
  }, [])

  const visible = y > 240 && !hidden
  const pct = Math.round(p * 100)

  return (
    <button
      type="button"
      className={`totop ${visible ? 'show' : ''}`}
      aria-label={`เลื่อนกลับขึ้นบนสุด (เลื่อนมาแล้ว ${pct}%)`}
      title={`กลับขึ้นบนสุด · ${pct}%`}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      <svg className="totop-ring" viewBox="0 0 56 56" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#35f0d0" />
            <stop offset="1" stopColor="#3a9bff" />
          </linearGradient>
        </defs>
        <circle className="track" cx="28" cy="28" r={R} />
        <circle
          className="bar" cx="28" cy="28" r={R} stroke={`url(#${gid})`}
          strokeDasharray={C} strokeDashoffset={C * (1 - p)} transform="rotate(-90 28 28)"
        />
      </svg>
      <span className="totop-face" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 16V4M4.5 9.5 10 4l5.5 5.5" />
        </svg>
      </span>
      <span className="totop-shine" aria-hidden="true" />
    </button>
  )
}
