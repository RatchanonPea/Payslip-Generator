import { useEffect } from 'react'

let locks = 0
let saved = ''

/** While `active`, the page behind a modal does not scroll. Safe when several modals overlap. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const el = document.documentElement
    if (locks === 0) saved = el.style.overflow
    locks++
    el.style.overflow = 'hidden' // html keeps its scrollbar gutter (theme.css), so the layout does not jump
    return () => {
      locks--
      if (locks === 0) el.style.overflow = saved
    }
  }, [active])
}
