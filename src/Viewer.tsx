import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BankCode, Computed, Settings } from './lib/types'
import { ensureFonts, type Page } from './lib/pdfDoc'
import { drawSlip, loadSignature } from './lib/slip'
import { PAPERS } from './lib/paper'
import { BANKS, parseEsso } from './lib/bankEsso'
import { baht } from './lib/format'
import { Select } from './Select'
import { useScrollLock } from './useScrollLock'
import { makeBank, makeEsso } from './lib/generate'
import { A4_RATIO, pnd1Pages, pnd1aPages, wht50bisPage } from './lib/taxReports'

const STACK = 5 // pages kept mounted above and below the current one

export type ViewerTab = 'slips' | 'tax' | 'bank' | 'esso'
const TABS: Array<{ key: ViewerTab; label: string }> = [
  { key: 'slips', label: 'สลิปเงินเดือน' },
  { key: 'tax', label: 'รายงานภาษี' },
  { key: 'bank', label: 'ไฟล์โอนเงิน' },
  { key: 'esso', label: 'ไฟล์ประกันสังคม' },
]
interface DocItem { key: string; label: string; ratio: number; draw: () => Page }

const ico = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
const IcoClose = () => <svg {...ico}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
const IcoPrev = () => <svg {...ico}><path d="M10 3L5 8l5 5" /></svg>
const IcoNext = () => <svg {...ico}><path d="M6 3l5 5-5 5" /></svg>
const IcoZoomIn = () => <svg {...ico}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14M7 5v4M5 7h4" /></svg>
const IcoZoomOut = () => <svg {...ico}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14M5 7h4" /></svg>

/** One page drawn onto a canvas; mounted only while it is near the front of the deck. */
function PageCanvas({ draw }: { draw: () => Page }) {
  const host = useRef<HTMLDivElement>(null)
  // layout effect: the page is on the canvas before the first paint, so a freshly mounted page never flashes blank
  useLayoutEffect(() => {
    const page = draw()
    page.canvas.className = 'slip'
    host.current?.replaceChildren(page.canvas)
    return () => host.current?.replaceChildren()
  }, [draw])
  return <div className="gal-canvas" ref={host} />
}

/**
 * Glass viewer for everything the app produces. Four tabs:
 * payslips and tax reports are a deck of pages (current one in front, the rest stacked and faded);
 * the bank and social-security files are plain text, shown as they would be uploaded.
 */
export function Viewer(props: {
  emps: Computed[]; settings: Settings; tab: ViewerTab; startIndex: number
  bank: BankCode; onBank: (b: BankCode) => void; onClose: (lastSlipIndex: number) => void
}) {
  const { emps, settings, startIndex, bank, onBank, onClose: onClosed } = props
  const paper = PAPERS[settings.paperSize] ?? PAPERS['9x5.5']
  const [tab, setTab] = useState<ViewerTab>(props.tab)
  const [cur, setCur] = useState(props.tab === 'slips' ? startIndex : 0)
  const [ready, setReady] = useState(false)
  // closing is animated: play the exit first, tell the parent to unmount afterwards
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const closeTimer = useRef<number | undefined>(undefined)
  const onClose = (last: number) => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    closeTimer.current = window.setTimeout(() => onClosed(last), 260)
  }
  useEffect(() => () => { window.clearTimeout(closeTimer.current); window.clearTimeout(leaveTimer.current) }, [])
  const [zoomed, setZoomed] = useState(false)
  const [leaving, setLeaving] = useState<{ item: DocItem; dir: number; id: number } | null>(null)
  const leaveTimer = useRef<number | undefined>(undefined)
  const [dir, setDir] = useState(1) // which way the last page change went, for the slide in the enlarged view
  const [rawText, setRawText] = useState(false)
  const zoomRef = useRef(false)
  const curRef = useRef(cur)
  const tabRef = useRef(tab)
  const acc = useRef(0)
  const touchY = useRef<number | null>(null)
  tabRef.current = tab
  useScrollLock(true) // the page behind must not move while the viewer is open
  zoomRef.current = zoomed

  useEffect(() => {
    let off = false
    Promise.all([ensureFonts(), loadSignature(settings.signatureDataUrl).catch(() => {})]).then(() => { if (!off) setReady(true) })
    return () => { off = true }
  }, [settings.signatureDataUrl])

  const isDeck = tab === 'slips' || tab === 'tax'

  const items = useMemo<DocItem[]>(() => {
    if (!ready) return []
    if (tab === 'slips') {
      return emps.map((e) => ({ key: `s${e.row}`, label: `${e.emp_id} ${e.full_name}`, ratio: paper.mmW / paper.mmH, draw: () => drawSlip(e, settings) }))
    }
    if (tab === 'tax') {
      const p1 = pnd1Pages(emps, settings)
      const p1a = pnd1aPages(emps, settings)
      return [
        ...p1.map((pg, i): DocItem => ({ key: `a${i}`, label: `ภ.ง.ด.1 · หน้า ${i + 1}/${p1.length}`, ratio: A4_RATIO, draw: () => pg })),
        ...p1a.map((pg, i): DocItem => ({ key: `b${i}`, label: `ภ.ง.ด.1ก · หน้า ${i + 1}/${p1a.length}`, ratio: A4_RATIO, draw: () => pg })),
        ...emps.map((e, i): DocItem => ({ key: `w${e.row}`, label: `50 ทวิ · ${e.emp_id} ${e.full_name}`, ratio: A4_RATIO, draw: () => wht50bisPage(e, settings, i + 1) })),
      ]
    }
    return []
  }, [ready, tab, emps, settings, paper.mmW, paper.mmH])

  const fileText = useMemo(() => {
    if (tab !== 'bank' && tab !== 'esso') return null
    const f = tab === 'bank' ? makeBank(bank, emps, settings) : makeEsso(emps, settings)
    const text = typeof f.data === 'string' ? f.data : new TextDecoder('windows-874').decode(f.data)
    return { name: f.name, text: text.replace(/^﻿/, '') }
  }, [tab, bank, emps, settings])

  const essoView = useMemo(() => (fileText && tab === 'esso' ? parseEsso(fileText.text) : null), [fileText, tab])

  const count = items.length
  const idx = Math.max(0, Math.min(cur, count - 1))

  const goTo = (i: number) => {
    const n = Math.max(0, Math.min(count - 1, i))
    if (n !== curRef.current) {
      const d = n > curRef.current ? 1 : -1
      setDir(d)
      // keep the page we are leaving on screen while it slides out
      const old = items[curRef.current]
      if (zoomRef.current && old) {
        setLeaving({ item: old, dir: d, id: Date.now() })
        window.clearTimeout(leaveTimer.current)
        leaveTimer.current = window.setTimeout(() => setLeaving(null), 820)
      }
    }
    curRef.current = n
    setCur(n)
  }
  const step = (d: number) => goTo(curRef.current + d)
  const pick = (t: ViewerTab) => { setTab(t); setZoomed(false); curRef.current = 0; setCur(0) }
  const close = () => onClose(tab === 'slips' ? curRef.current : startIndex)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = el.tagName === 'SELECT' || el.tagName === 'INPUT'
      // Esc peels one layer: zoomed page -> deck -> closed
      if (e.key === 'Escape') { if (zoomRef.current) setZoomed(false); else onClose(tabRef.current === 'slips' ? curRef.current : startIndex) }
      else if (typing || !(tabRef.current === 'slips' || tabRef.current === 'tax')) return
      else if ((zoomRef.current ? ['ArrowRight'] : ['ArrowDown', 'ArrowRight', 'PageDown']).includes(e.key)) { e.preventDefault(); step(1) }
      else if ((zoomRef.current ? ['ArrowLeft'] : ['ArrowUp', 'ArrowLeft', 'PageUp']).includes(e.key)) { e.preventDefault(); step(-1) }
      else if (e.key === 'Home') { e.preventDefault(); goTo(0) }
      else if (e.key === 'End') { e.preventDefault(); goTo(count - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onWheel = (e: React.WheelEvent) => {
    if (!isDeck) return
    acc.current += e.deltaY
    if (Math.abs(acc.current) >= 70) { step(acc.current > 0 ? 1 : -1); acc.current = 0 }
  }

  const visible: number[] = []
  for (let i = Math.max(0, idx - STACK); i <= Math.min(count - 1, idx + STACK); i++) visible.push(i)

  return (
    <>
      <div className={`gal-backdrop ${closing ? 'out' : ''}`} onClick={close} />
      <div className={`gallery ${closing ? 'out' : ''}`} role="dialog" aria-modal="true" aria-label="ตัวอย่างเอกสาร">
        <div className="gal-bar">
          <button className="gbtn" type="button" autoFocus onClick={close} aria-label="ปิด" title="ปิด (Esc)"><IcoClose /></button>
          <div className="gal-tabs" role="tablist" aria-label="ประเภทเอกสาร">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => pick(t.key)}>{t.label}</button>
            ))}
          </div>
          <div className="gal-tools">
            {isDeck && count > 0 && (
              <>
                <span className="gal-now">{idx + 1} / {count}</span>
                <Select variant="pill" ariaLabel="ข้ามไปหน้าอื่น" value={String(idx)} onChange={(v) => goTo(Number(v))}
                  options={items.map((it, i) => ({ value: String(i), label: it.label }))} />
                <button className="gbtn" type="button" onClick={() => step(-1)} aria-label="หน้าก่อนหน้า" title="ก่อนหน้า (←)"><IcoPrev /></button>
                <button className="gbtn" type="button" onClick={() => step(1)} aria-label="หน้าถัดไป" title="ถัดไป (→)"><IcoNext /></button>
                <button className="gbtn" type="button" aria-pressed={zoomed} onClick={() => setZoomed((z) => !z)} aria-label={zoomed ? 'ย่อ' : 'ขยาย'} title={zoomed ? 'ย่อ (Esc)' : 'ขยาย'}>
                  {zoomed ? <IcoZoomOut /> : <IcoZoomIn />}
                </button>
              </>
            )}
            {tab === 'bank' && (
              <Select variant="pill" ariaLabel="เลือกธนาคาร" value={bank} onChange={(v) => onBank(v as BankCode)}
                options={BANKS.map((b) => ({ value: b.code, label: b.label }))} />
            )}
          </div>
        </div>

        {isDeck && zoomed && count > 0 ? (
          <div className="gal-zoom" onClick={() => setZoomed(false)} title="คลิกเพื่อย่อ (Esc)">
            <div className="gal-zoom-cap">{items[idx].label} · {idx + 1}/{count} · คลิกหรือกด Esc เพื่อย่อ</div>
            <div className="gal-zstage">
              {leaving && leaving.item.key !== items[idx].key && (
                <div key={`out-${leaving.id}`} className={`gal-zslide out ${leaving.dir > 0 ? 'next' : 'prev'}`} aria-hidden="true">
                  <PageCanvas draw={leaving.item.draw} />
                </div>
              )}
              <div key={items[idx].key} className={`gal-zslide in ${dir > 0 ? 'next' : 'prev'}`}>
                <PageCanvas draw={items[idx].draw} />
              </div>
            </div>
          </div>
        ) : isDeck ? (
          <div
            className="gal-stage" onWheel={onWheel}
            onTouchStart={(e) => { touchY.current = e.touches[0].clientY }}
            onTouchEnd={(e) => {
              if (touchY.current == null) return
              const dy = touchY.current - e.changedTouches[0].clientY
              if (Math.abs(dy) > 40) step(dy > 0 ? 1 : -1)
              touchY.current = null
            }}
          >
            {visible.map((i) => {
              const d = i - idx
              const a = Math.abs(d)
              const it = items[i]
              const fade = [0, 0.6, 0.78, 0.88, 0.93, 0.96][Math.min(a, 5)]
              return (
                <section
                  key={it.key}
                  className={`gal-card ${a === 0 ? 'front' : ''}`}
                  style={{
                    ['--ratio' as string]: it.ratio,
                    zIndex: 100 - a,
                    transform: `translate(-50%, -50%) translateY(${d * 34 + (d === 0 ? 0 : d > 0 ? 40 : -40)}px) scale(${Math.max(0.6, 1 - a * 0.05)})`,
                    filter: a === 0 ? undefined : `blur(${Math.min(2.5, a * 0.7)}px)`,
                    ['--fade' as string]: fade,
                  }}
                  onClick={() => { if (a !== 0) goTo(i); else setZoomed(true) }}
                  aria-current={a === 0}
                  aria-label={it.label}
                >
                  <PageCanvas draw={it.draw} />
                  <span className="gal-shade" />
                </section>
              )
            })}
            {count > 0 && (
              <div className="gal-label" aria-live="polite">
                {items[idx].label}
                <small>เลื่อนเมาส์ หรือกด ↑ ↓ เพื่อเปลี่ยนหน้า · คลิกหน้าหลักเพื่อขยาย</small>
              </div>
            )}
          </div>
        ) : (
          <div className="gal-file">
            <div className="gal-file-head">
              <b>{fileText?.name}</b>
              <small>เนื้อไฟล์ที่จะดาวน์โหลด · {fileText?.text.split(/\r?\n/).filter(Boolean).length ?? 0} บรรทัด</small>
            </div>
            {tab === 'esso' && (!settings.ssoAccountNo.trim() || !settings.companyName.trim()) && (
              <div className="banner warn" style={{ marginTop: 0 }}>
                ยังไม่ได้กรอก{!settings.ssoAccountNo.trim() ? 'เลขที่บัญชีประกันสังคม' : ''}{!settings.ssoAccountNo.trim() && !settings.companyName.trim() ? ' และ' : ''}{!settings.companyName.trim() ? 'ชื่อบริษัท' : ''} (ขั้นตอนที่ 4) หัวไฟล์จึงเป็นเลข 0 / ช่องว่าง
              </div>
            )}
            {tab === 'esso' && (
              <div className="gal-seg" role="group" aria-label="รูปแบบการแสดง">
                <button type="button" className={!rawText ? 'on' : ''} onClick={() => setRawText(false)}>ตาราง</button>
                <button type="button" className={rawText ? 'on' : ''} onClick={() => setRawText(true)}>ข้อความดิบ</button>
              </div>
            )}
            {tab === 'esso' && !rawText && essoView ? (
              <div className="gal-table" tabIndex={0}>
                <dl className="esso-head">
                  <div><dt>เลขที่บัญชี สปส.</dt><dd>{essoView.head.account}</dd></div>
                  <div><dt>ลำดับที่สาขา</dt><dd>{essoView.head.branch}</dd></div>
                  <div><dt>วันที่จ่าย (วว/ดด/ปป พ.ศ.)</dt><dd>{essoView.head.payDate}</dd></div>
                  <div><dt>งวด (ดด/ปป พ.ศ.)</dt><dd>{essoView.head.month}/{essoView.head.year}</dd></div>
                  <div className="wide"><dt>ชื่อสถานประกอบการ</dt><dd>{essoView.head.company || '—'}</dd></div>
                  <div><dt>อัตราสมทบ</dt><dd>{essoView.head.ratePct}%</dd></div>
                  <div><dt>ผู้ประกันตน</dt><dd>{essoView.head.count} คน</dd></div>
                  <div><dt>รวมค่าจ้าง</dt><dd>{baht(essoView.head.totalWage)}</dd></div>
                  <div><dt>รวมเงินสมทบ</dt><dd>{baht(essoView.head.totalSso)}</dd></div>
                </dl>
                <table>
                  <thead><tr><th>#</th><th>เลขบัตรประชาชน</th><th>คำนำหน้า</th><th>ชื่อ</th><th>นามสกุล</th><th className="n">ค่าจ้าง</th><th className="n">เงินสมทบ</th></tr></thead>
                  <tbody>
                    {essoView.rows.map((r, i) => (
                      <tr key={i}><td>{i + 1}</td><td>{r.id}</td><td>{r.prefix}</td><td>{r.first}</td><td>{r.last}</td><td className="n">{baht(r.wage)}</td><td className="n">{baht(r.sso)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <pre tabIndex={0} aria-label={`เนื้อหาของ ${fileText?.name}`}>{fileText?.text}</pre>
                {tab === 'esso' && <small className="gal-file-note">ข้อความดิบเป็นความกว้างคงที่ ตัวอักษรไทยในหน้านี้จึงดูเหลื่อมกัน แต่ในไฟล์ที่ดาวน์โหลดแต่ละช่องตรงกันตามความกว้างที่กำหนด</small>}
              </>
            )}
            <small className="gal-file-note">รูปแบบทั่วไป ตรวจกับแม่แบบของ{tab === 'bank' ? 'ธนาคาร' : ' สปส.'}ก่อนใช้งานจริง</small>
          </div>
        )}
      </div>
    </>
  )
}
