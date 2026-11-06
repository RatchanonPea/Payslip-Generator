import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FIELDS, defaultSettings } from './lib/fields'
import { autoMap } from './lib/mapping'
import { parseFile, templateCsv, type ParsedFile } from './lib/parse'
import { buildEmployees } from './lib/validate'
import { compute } from './lib/calc'
import { baht, download } from './lib/format'
import { ensureFonts } from './lib/pdfDoc'
import { drawSlip, loadSignature, signaturePreview } from './lib/slip'
import { Viewer, type ViewerTab } from './Viewer'
import { Select } from './Select'
import { DatePicker } from './Picker'
import { useScrollLock } from './useScrollLock'
import { ScrollTop } from './ScrollTop'
import { BANKS } from './lib/bankEsso'
import { makeBank, makeEsso, payslipZip, taxZip } from './lib/generate'
import { PAPERS, PAPER_KEYS } from './lib/paper'
import type { BankCode, FieldKey, Mapping, PaperKey, Settings, SsoBase, TaxMode /*, PasswordFormat */ } from './lib/types'

const toPct = (rate: number) => Number((rate * 100).toFixed(4))

/** A table cell you can type into: shows the formatted value, switches to the raw text while focused, saves on Enter / leaving, Esc undoes. */
function EditCell(props: { value: string; shown?: string; num?: boolean; disabled?: boolean; label: string; onCommit: (v: string) => void }) {
  const { value, shown, num, disabled, label, onCommit } = props
  const [draft, setDraft] = useState<string | null>(null)
  if (disabled) return <span className="ec-ro">{shown ?? (value || '-')}</span>
  const commit = () => { if (draft !== null && draft !== value) onCommit(draft); setDraft(null) }
  return (
    <input
      className={`ec ${num ? 'n' : ''}`} aria-label={label} inputMode={num ? 'decimal' : 'text'} spellCheck={false}
      value={draft ?? (shown ?? value)}
      onFocus={(e) => { setDraft(value); requestAnimationFrame(() => e.target.select()) }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur() }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(null); (e.target as HTMLInputElement).blur() }
      }}
    />
  )
}

const STEP_NAMES = ['อัปโหลดไฟล์', 'จับคู่คอลัมน์', 'ตรวจสอบข้อมูล', 'ข้อมูลบริษัท', 'สร้างเอกสาร']

type Busy = { kind: string; done: number; total: number } | null

export default function App() {
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [fileName, setFileName] = useState('')
  const [mapping, setMapping] = useState<Mapping>({})
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [error, setError] = useState('')
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [bank, setBank] = useState<BankCode>('KBANK')
  const [previewIdx, setPreviewIdx] = useState(0)
  const [showAllIssues, setShowAllIssues] = useState(false)
  const canvasHost = useRef<HTMLDivElement>(null)
  const [viewer, setViewer] = useState<ViewerTab | null>(null)
  const zoom = viewer !== null
  useEffect(() => {
    const el = document.querySelector('.top')
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--top-h', `${el.getBoundingClientRect().height}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})
  // Accordion with a single focus: opening a step folds the others; clicking the only open step folds it.
  // `scroll` is used by the side rail, which also brings the step into view once the others have folded.
  // Sequence (like a single-page app): 1) the step that was open folds, 2) then the chosen one opens and the page glides to it.
  const FOLD_MS = 400 // a little longer than the fold animation in theme.css (.38s)
  const seq = useRef<number | undefined>(undefined)
  const focusStep = (n: number) => {
    const locked: Record<number, boolean> = { 1: false, 2: !parsed, 3: !mapOk, 4: !dataOk, 5: !ready }
    if (locked[n]) return
    window.clearTimeout(seq.current)
    const all = [1, 2, 3, 4, 5]
    const othersOpen = all.some((k) => k !== n && !locked[k] && !collapsed[k])
    const goTo = () => document.getElementById(`step-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

    if (!collapsed[n] && !othersOpen) { // the only open step: just fold it
      setCollapsed((c) => ({ ...c, [n]: true }))
      return
    }
    // phase 1: fold everything else (the target keeps its state)
    setCollapsed(Object.fromEntries(all.map((k) => [k, k === n ? !!collapsed[n] : true])))
    // phase 2: once the old step has folded, open the target and scroll to it
    seq.current = window.setTimeout(() => {
      setCollapsed(Object.fromEntries(all.map((k) => [k, k !== n])))
      requestAnimationFrame(goTo)
    }, othersOpen ? FOLD_MS : 0)
  }

  const { employees, issues } = useMemo(
    () => (parsed ? buildEmployees(parsed.rows, mapping) : { employees: [], issues: [] }),
    [parsed, mapping],
  )
  const computed = useMemo(() => employees.map((e) => compute(e, settings)), [employees, settings])
  // edit a cell of the data table: write it back into the uploaded rows, so checks and calculations rerun
  const editCell = (row: number, key: FieldKey, value: string) => {
    const col = mapping[key]
    if (!col) return
    setParsed((p) => (p ? { ...p, rows: p.rows.map((r, i) => (i === row - 2 ? { ...r, [col]: value } : r)) } : p))
  }
  const rawOf = (row: number, key: FieldKey) => {
    const col = mapping[key]
    const v = col && parsed ? parsed.rows[row - 2]?.[col] : ''
    return v == null ? '' : String(v)
  }
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')
  const missingRequired = FIELDS.filter((f) => f.required && !mapping[f.key])
  const mapOk = !!parsed && missingRequired.length === 0
  const dataOk = mapOk && errors.length === 0 && computed.length > 0
  const settingsOk = settings.companyName.trim() !== ''
  const ready = dataOk && settingsOk
  // worst problem per spreadsheet row, so the data table can flag the rows that need fixing
  const rowIssue = new Map<number, 'error' | 'warning'>()
  for (const i of issues) if (rowIssue.get(i.row) !== 'error') rowIssue.set(i.row, i.level)

  // The address box starts with the company name (editable); typing the name fills it in, leaving the next line free to type.
  const changeCompanyName = (name: string) =>
    setSettings((st) => {
      const lines = st.companyAddress.split('\n')
      const followsName = st.companyAddress === '' || lines[0] === st.companyName
      if (!followsName) return { ...st, companyName: name }
      const rest = st.companyAddress === '' ? [''] : lines.slice(1)
      return { ...st, companyName: name, companyAddress: name ? [name, ...rest].join('\n') : rest.join('\n') }
    })

  const upd = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }))

  async function load(file: File) {
    setError('')
    try {
      const p = await parseFile(file)
      setParsed(p)
      setFileName(file.name)
      setMapping(autoMap(p.headers))
      setPreviewIdx(0)
      setCollapsed({}) // a fresh file: every step open, nothing hidden
    } catch (e) {
      setParsed(null)
      setFileName('')
      setError(e instanceof Error ? e.message : 'อ่านไฟล์ไม่สำเร็จ')
    }
  }

  // live preview of the slip
  const safeIdx = Math.min(previewIdx, Math.max(0, computed.length - 1))
  useEffect(() => {
    const host = canvasHost.current
    if (!host) return
    host.replaceChildren()
    if (!dataOk || !computed[safeIdx]) return
    let cancelled = false
    Promise.all([ensureFonts(), loadSignature(settings.signatureDataUrl).catch(() => {})]).then(() => {
      if (cancelled) return
      const page = drawSlip(computed[safeIdx], settings)
      page.canvas.className = 'slip'
      page.canvas.setAttribute('role', 'img')
      page.canvas.setAttribute('aria-label', `ตัวอย่างสลิปของ ${computed[safeIdx].full_name}`)
      host.replaceChildren(page.canvas)
    })
    return () => { cancelled = true }
  }, [computed, safeIdx, settings, dataOk])

  const count = computed.length
  const go = (d: number) => count > 0 && setPreviewIdx((safeIdx + d + count) % count)

  // ← → flip through employees (not while typing in a field, and the dropdown keeps its own arrows)
  useEffect(() => {
    if (!dataOk || zoom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const t = e.target as HTMLElement | null
      if (t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return
      e.preventDefault()
      go(e.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })


  async function run(kind: string, total: number, fn: (p: (d: number, t: number) => void) => Promise<void> | void) {
    setError('')
    setBusy({ kind, done: 0, total })
    try {
      await fn((done, t) => setBusy({ kind, done, total: t }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'สร้างไฟล์ไม่สำเร็จ')
    } finally {
      setBusy(null)
    }
  }

  const pct = busy && busy.total ? Math.round((busy.done / busy.total) * 100) : 0
  const totalNet = computed.reduce((a, e) => a + e.net, 0)

  return (
    <>
      <header className="top">
        <div className="top-in">
          <div className="brand">
            <span className="logo" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h4" />
              </svg>
            </span>
            <div>
              <h1>สร้างสลิปเงินเดือน</h1>
              <p>อัปโหลดรายชื่อพนักงาน แล้วได้สลิป PDF รายงานภาษี และไฟล์โอนเงิน</p>
            </div>
          </div>
          <span className="lock">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" />
            </svg>
            ประมวลผลในเครื่องคุณ ไม่อัปโหลดข้อมูลขึ้นเซิร์ฟเวอร์
          </span>
        </div>
      </header>

      <main className="shell">
        <div className="rail-col">
          <nav className="rail" aria-label="ขั้นตอน">
            {STEP_NAMES.map((name, i) => {
              const k = i + 1
              const done = [parsed, mapOk, dataOk, settingsOk && dataOk, false][i]
              const lock = [false, !parsed, !mapOk, !dataOk, !ready][i]
              const isOpen = !lock && !collapsed[k]
              return (
                <button
                  key={k} type="button" disabled={lock}
                  className={`rail-btn ${isOpen ? 'open' : ''} ${done ? 'done' : ''} ${lock ? 'locked' : ''}`}
                  aria-pressed={isOpen} aria-label={`ขั้นตอนที่ ${k} ${name}${lock ? ' (ยังไม่พร้อม)' : ''}`}
                  onClick={() => focusStep(k)}
                >
                  <span className="rail-n">{k}</span>
                  <span className="rail-t">{name}</span>
                </button>
              )
            })}
          </nav>
        </div>
        <div className="steps">
          <div className="fold-all">
            <button type="button" className="link" onClick={() => setCollapsed({ 1: true, 2: true, 3: true, 4: true, 5: true })}>ย่อทั้งหมด</button>
            <span aria-hidden="true"> · </span>
            <button type="button" className="link" onClick={() => setCollapsed({})}>ขยายทั้งหมด</button>
          </div>
          {/* 1 upload */}
          <section id="step-1" className={`step ${parsed ? 'done' : ''} ${collapsed[1] ? 'collapsed' : ''}`}>
            <StepHead n={1} title="อัปโหลดข้อมูลพนักงาน" collapsed={!!collapsed[1]} onToggle={() => focusStep(1)} />
            <div className="step-body"><div className="step-inner">
            <p className="sub">รองรับ .xlsx .xls .csv (ไม่เกิน 25 MB)</p>
            <label
              className={`drop ${over ? 'over' : ''} ${parsed ? 'loaded' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) load(f) }}
            >
              <strong>{fileName || 'ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์'}</strong>
              <span>{parsed ? `${parsed.rows.length} แถว · ชีต ${parsed.sheet} · ${parsed.encoding}` : 'ข้อมูลอ่านในเบราว์เซอร์เท่านั้น'}</span>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = '' }} />
            </label>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="link" type="button" onClick={() => download('payslip-template.csv', templateCsv(), 'text/csv;charset=utf-8')}>
                ดาวน์โหลดไฟล์ตัวอย่าง (CSV)
              </button>
            </div>
            {error && <div className="banner err" role="alert">{error}</div>}
            </div></div>
          </section>

          {/* 2 mapping */}
          <section id="step-2" className={`step ${mapOk ? 'done' : ''} ${parsed ? '' : 'locked'} ${collapsed[2] ? 'collapsed' : ''}`}>
            <StepHead n={2} title="จับคู่คอลัมน์" collapsed={!!collapsed[2]} onToggle={() => focusStep(2)} />
            <div className="step-body"><div className="step-inner">
            <p className="sub">ระบบเดาให้อัตโนมัติ ตรวจสอบและแก้ได้</p>
            {parsed && (
              <>
                <div className="map">
                  {FIELDS.map((f) => (
                    <div className="field" key={f.key}>
                      <label htmlFor={`m-${f.key}`}>{f.label}{f.required && <span className="req"> *</span>}</label>
                      <Select
                        id={`m-${f.key}`}
                        value={mapping[f.key] ?? ''}
                        onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v || undefined }))}
                        options={[{ value: '', label: '— ไม่ใช้ —' }, ...parsed.headers.map((h) => ({ value: h, label: h }))]}
                      />
                      <small>{f.hint}</small>
                    </div>
                  ))}
                </div>
                {missingRequired.length > 0 && (
                  <div className="banner err" role="alert">ยังไม่ได้เลือกคอลัมน์ที่จำเป็น: {missingRequired.map((f) => f.label).join(', ')}</div>
                )}
              </>
            )}
            </div></div>
          </section>

          {/* 3 review */}
          <section id="step-3" className={`step ${dataOk ? 'done' : ''} ${mapOk ? '' : 'locked'} ${collapsed[3] ? 'collapsed' : ''}`}>
            <StepHead n={3} title="ตรวจสอบข้อมูล" collapsed={!!collapsed[3]} onToggle={() => focusStep(3)} />
            <div className="step-body"><div className="step-inner">
            <p className="sub">แก้ไฟล์ต้นฉบับแล้วอัปโหลดใหม่ หากพบข้อผิดพลาด</p>
            {mapOk && (
              <>
                <div className="stats">
                  <div className="stat"><b>{computed.length}</b><span>พนักงาน</span></div>
                  <div className="stat"><b>{errors.length}</b><span>ข้อผิดพลาด</span></div>
                  <div className="stat"><b>{warnings.length}</b><span>คำเตือน</span></div>
                  <div className="stat"><b>{baht(totalNet)}</b><span>เงินสุทธิรวม (บาท)</span></div>
                </div>
                {issues.length === 0 ? (
                  <div className="banner ok">ข้อมูลครบถ้วน พร้อมสร้างเอกสาร</div>
                ) : (
                  <>
                    <div className="tablewrap">
                      <table>
                        <thead><tr><th>แถว</th><th>รหัส</th><th>ระดับ</th><th>รายละเอียด</th></tr></thead>
                        <tbody>
                          {(showAllIssues ? issues : issues.slice(0, 50)).map((i, k) => (
                            <tr key={k}>
                              <td>{i.row}</td><td>{i.emp_id || '-'}</td>
                              <td><span className={`tag ${i.level}`}>{i.level === 'error' ? 'ผิดพลาด' : 'เตือน'}</span></td>
                              <td>{i.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {issues.length > 50 && !showAllIssues && (
                      <button className="link" type="button" onClick={() => setShowAllIssues(true)}>แสดงทั้งหมด {issues.length} รายการ</button>
                    )}
                  </>
                )}
                {computed.length > 0 && (
                  <>
                    <h3 className="data-title">ข้อมูลพนักงานทั้งหมด ({computed.length} คน)<small className="data-hint">คลิกที่ช่องเพื่อแก้ไข · Enter บันทึก · Esc ยกเลิก</small></h3>
                    <div className="tablewrap data-table">
                      <table>
                        <thead>
                          <tr>
                            <th>แถว</th><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>แผนก</th>
                            <th className="n">เงินเดือน</th><th className="n">OT</th><th className="n">เบี้ยเลี้ยง</th><th className="n">โบนัส</th>
                            <th className="n">รวมรายได้</th><th className="n">ประกันสังคม</th><th className="n">ภาษี</th><th className="n">หักอื่น ๆ</th><th className="n">สุทธิ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {computed.map((e) => (
                            <tr key={e.row} className={rowIssue.get(e.row) ? `row-${rowIssue.get(e.row)}` : ''}>
                              <td>{e.row}</td>
                              <td><EditCell value={rawOf(e.row, 'emp_id')} disabled={!mapping.emp_id} label="รหัส" onCommit={(v) => editCell(e.row, 'emp_id', v)} /></td>
                              <td><EditCell value={rawOf(e.row, 'full_name')} disabled={!mapping.full_name} label="ชื่อ-นามสกุล" onCommit={(v) => editCell(e.row, 'full_name', v)} /></td>
                              <td><EditCell value={rawOf(e.row, 'department')} disabled={!mapping.department} label="แผนก" onCommit={(v) => editCell(e.row, 'department', v)} /></td>
                              {(['base_salary', 'ot_pay', 'allowances', 'bonus'] as const).map((k) => (
                                <td key={k} className="n"><EditCell num value={rawOf(e.row, k)} shown={baht(e[k])} disabled={!mapping[k]} label={FIELDS.find((f) => f.key === k)?.label ?? k} onCommit={(v) => editCell(e.row, k, v)} /></td>
                              ))}
                              <td className="n">{baht(e.gross)}</td><td className="n">{baht(e.sso)}</td><td className="n">{baht(e.tax)}</td><td className="n"><EditCell num value={rawOf(e.row, 'deductions_other')} shown={baht(e.deductions_other)} disabled={!mapping.deductions_other} label="หักอื่น ๆ" onCommit={(v) => editCell(e.row, 'deductions_other', v)} /></td><td className="n"><b>{baht(e.net)}</b></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {errors.length > 0 && <div className="banner err" role="alert">ต้องแก้ข้อผิดพลาดก่อนจึงจะสร้างเอกสารได้</div>}
              </>
            )}
            </div></div>
          </section>

          {/* 4 settings */}
          <section id="step-4" className={`step ${settingsOk && dataOk ? 'done' : ''} ${dataOk ? '' : 'locked'} ${collapsed[4] ? 'collapsed' : ''}`}>
            <StepHead n={4} title="ข้อมูลบริษัทและงวดเงินเดือน" collapsed={!!collapsed[4]} onToggle={() => focusStep(4)} />
            <div className="step-body"><div className="step-inner">
            <p className="sub">ใช้พิมพ์บนสลิปและเอกสารภาษี</p>
            {dataOk && (
              <>
                <div className="grid2">
                  <div className="field wide">
                    <label htmlFor="co">ชื่อบริษัท <span className="req">*</span></label>
                    <input id="co" value={settings.companyName} onChange={(e) => changeCompanyName(e.target.value)} />
                  </div>
                  <div className="field wide">
                    <AddressField value={settings.companyAddress} onChange={(v) => upd('companyAddress', v)} />
                  </div>
                  <div className="field">
                    <label htmlFor="per">งวดเงินเดือน</label>
                    <DatePicker id="per" mode="month" value={settings.period} onChange={(v) => upd('period', v)} />
                  </div>
                  <div className="field">
                    <label htmlFor="pd">วันที่จ่าย</label>
                    <DatePicker id="pd" mode="date" value={settings.payDate} onChange={(v) => upd('payDate', v)} />
                  </div>
                  <div className="field wide">
                    <label htmlFor="paper">ขนาดกระดาษสลิป</label>
                    <Select id="paper" value={settings.paperSize} onChange={(v) => upd('paperSize', v as PaperKey)}
                      options={PAPER_KEYS.map((k) => ({ value: k, label: PAPERS[k].label }))} />
                  </div>
                  <div className="field wide">
                    <SignatureField
                      value={settings.signatureDataUrl}
                      name={settings.signerName}
                      onChange={(v) => upd('signatureDataUrl', v)}
                      onName={(v) => upd('signerName', v)}
                    />
                  </div>
                  {/* PDF password disabled for now
                  <div className="field">
                    <label htmlFor="pw">รูปแบบรหัสผ่าน PDF (วันเกิดพนักงาน)</label>
                    <select id="pw" value={settings.passwordFormat} onChange={(e) => upd('passwordFormat', e.target.value as PasswordFormat)}>
                      <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                      <option value="YYYYMMDD">YYYYMMDD</option>
                      <option value="DDMMYYYY">DDMMYYYY</option>
                    </select>
                  </div>
                  */}
                </div>
                <details>
                  <summary>ข้อมูลภาษี ประกันสังคม และบัญชีบริษัท</summary>
                  <div className="grid2">
                    <div className="field">
                      <label htmlFor="tid">เลขประจำตัวผู้เสียภาษีบริษัท</label>
                      <input id="tid" inputMode="numeric" value={settings.companyTaxId} onChange={(e) => upd('companyTaxId', e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="cba">เลขบัญชีบริษัท (ไฟล์โอนเงิน)</label>
                      <input id="cba" inputMode="numeric" value={settings.companyBankAccount} onChange={(e) => upd('companyBankAccount', e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="sa">เลขที่บัญชีประกันสังคม</label>
                      <input id="sa" inputMode="numeric" value={settings.ssoAccountNo} onChange={(e) => upd('ssoAccountNo', e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="sb">ลำดับที่สาขา</label>
                      <input id="sb" inputMode="numeric" value={settings.ssoBranch} onChange={(e) => upd('ssoBranch', e.target.value)} />
                    </div>
                  </div>
                </details>
                <details>
                  <summary>สูตรคำนวณประกันสังคมและภาษี (ปรับได้)</summary>
                  <div className="grid2">
                    <div className="field wide">
                      <label><input type="checkbox" checked={settings.ssoEnabled} onChange={(e) => upd('ssoEnabled', e.target.checked)} style={{ width: 'auto', minHeight: 0 }} /> หักประกันสังคม</label>
                    </div>
                    {settings.ssoEnabled && (
                      <>
                        <div className="field">
                          <label htmlFor="sbase">คิดประกันสังคมจาก</label>
                          <Select id="sbase" value={settings.ssoBase} onChange={(v) => upd('ssoBase', v as SsoBase)}
                            options={[{ value: 'base', label: 'เงินเดือนพื้นฐาน' }, { value: 'gross', label: 'รายได้รวมทั้งหมด' }]} />
                        </div>
                        <div className="field">
                          <label htmlFor="sr">อัตรา (%)</label>
                          <input id="sr" type="number" step="0.1" min="0" value={toPct(settings.ssoRate)} onChange={(e) => upd('ssoRate', Number(e.target.value) / 100)} />
                        </div>
                        <div className="field">
                          <label htmlFor="smin">ฐานค่าจ้างต่ำสุด (บาท)</label>
                          <input id="smin" type="number" min="0" value={settings.ssoMinBase} onChange={(e) => upd('ssoMinBase', Number(e.target.value))} />
                        </div>
                        <div className="field">
                          <label htmlFor="sm">ฐานค่าจ้างสูงสุด (บาท)</label>
                          <input id="sm" type="number" min="0" value={settings.ssoMaxBase} onChange={(e) => upd('ssoMaxBase', Number(e.target.value))} />
                        </div>
                        <div className="field">
                          <label htmlFor="smc">เงินสมทบสูงสุดต่อเดือน (บาท)</label>
                          <input id="smc" type="number" min="0" value={settings.ssoMaxContribution} onChange={(e) => upd('ssoMaxContribution', Number(e.target.value))} />
                        </div>
                      </>
                    )}
                    <div className="field wide">
                      <label htmlFor="tm">วิธีคำนวณภาษีหัก ณ ที่จ่าย</label>
                      <Select id="tm" value={settings.taxMode} onChange={(v) => upd('taxMode', v as TaxMode)}
                        options={[
                          { value: 'progressive', label: 'อัตราก้าวหน้า (ประมาณการทั้งปี)' },
                          { value: 'flat', label: 'เหมาเป็น % ของรายได้' },
                          { value: 'none', label: 'ไม่หักภาษี' },
                        ]} />
                    </div>
                    {settings.taxMode === 'flat' && (
                      <div className="field">
                        <label htmlFor="ft">อัตราภาษี (%)</label>
                        <input id="ft" type="number" step="0.1" min="0" value={toPct(settings.flatTaxRate)} onChange={(e) => upd('flatTaxRate', Number(e.target.value) / 100)} />
                      </div>
                    )}
                    {settings.taxMode === 'progressive' && (
                      <>
                        <div className="field">
                          <label htmlFor="er">หักค่าใช้จ่าย (% ของรายได้ต่อปี)</label>
                          <input id="er" type="number" step="1" min="0" value={toPct(settings.expenseRate)} onChange={(e) => upd('expenseRate', Number(e.target.value) / 100)} />
                        </div>
                        <div className="field">
                          <label htmlFor="ec">เพดานค่าใช้จ่ายต่อปี (บาท)</label>
                          <input id="ec" type="number" min="0" value={settings.expenseCap} onChange={(e) => upd('expenseCap', Number(e.target.value))} />
                        </div>
                        <div className="field">
                          <label htmlFor="pa">ค่าลดหย่อนส่วนตัวต่อปี (บาท)</label>
                          <input id="pa" type="number" min="0" value={settings.personalAllowance} onChange={(e) => upd('personalAllowance', Number(e.target.value))} />
                        </div>
                      </>
                    )}
                  </div>
                  <small style={{ display: 'block', marginTop: 8, color: 'var(--muted)' }}>
                    ถ้าไฟล์ข้อมูลมีคอลัมน์ประกันสังคม/ภาษีของพนักงานคนนั้น ระบบจะใช้ค่าในไฟล์แทนสูตร
                  </small>
                </details>
                {!settingsOk && <div className="banner warn">กรอกชื่อบริษัทเพื่อปลดล็อกการสร้างเอกสาร</div>}
              </>
            )}
            </div></div>
          </section>

          {/* 5 outputs */}
          <section id="step-5" className={`step ${ready ? '' : 'locked'} ${collapsed[5] ? 'collapsed' : ''}`}>
            <StepHead n={5} title="สร้างเอกสาร" collapsed={!!collapsed[5]} onToggle={() => focusStep(5)} />
            <div className="step-body"><div className="step-inner">
            <p className="sub">เลือกเอกสารที่ต้องการดาวน์โหลด</p>
            {ready && (
              <>
                <div className="out">
                  <div className="card">
                    <h3>สลิปเงินเดือน (PDF)</h3>
                    <p>ZIP รวม PDF ของพนักงานทุกคน {computed.length} ฉบับ</p>
                    <button className="btn accent" disabled={!!busy} onClick={() => run('slip', computed.length, async (p) => {
                      download(`payslips_${settings.period}.zip`, await payslipZip(computed, settings, p), 'application/zip')
                    })}>ดาวน์โหลดสลิป</button>
                    <button className="btn ghost" type="button" onClick={() => setViewer('slips')}><span className="btn-ico" aria-hidden="true">👁</span> ดูตัวอย่าง</button>
                  </div>
                  <div className="card">
                    <h3>รายงานภาษี</h3>
                    <p>ภ.ง.ด.1 ภ.ง.ด.1ก และหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)</p>
                    <button className="btn" disabled={!!busy} onClick={() => run('tax', computed.length + 2, async (p) => {
                      download(`tax_${settings.period}.zip`, await taxZip(computed, settings, p), 'application/zip')
                    })}>ดาวน์โหลดรายงานภาษี</button>
                    <button className="btn ghost" type="button" onClick={() => setViewer('tax')}><span className="btn-ico" aria-hidden="true">👁</span> ดูตัวอย่าง</button>
                  </div>
                  <div className="card">
                    <h3>ไฟล์โอนเงินเดือน</h3>
                    <div className="field">
                      <label htmlFor="bk" className="sr-only" style={{ position: 'absolute', left: -9999 }}>ธนาคาร</label>
                      <Select id="bk" ariaLabel="เลือกธนาคาร" value={bank} onChange={(v) => setBank(v as BankCode)}
                        options={BANKS.map((b) => ({ value: b.code, label: b.label }))} />
                    </div>
                    <p>รูปแบบทั่วไป ตรวจกับแม่แบบของธนาคารก่อนอัปโหลดจริง</p>
                    <button className="btn" disabled={!!busy} onClick={() => {
                      const f = makeBank(bank, computed, settings)
                      download(f.name, f.data)
                    }}>ดาวน์โหลดไฟล์โอนเงิน</button>
                    <button className="btn ghost" type="button" onClick={() => setViewer('bank')}><span className="btn-ico" aria-hidden="true">👁</span> ดูตัวอย่าง</button>
                  </div>
                  <div className="card">
                    <h3>ไฟล์ประกันสังคม (e-Service)</h3>
                    <p>ไฟล์สมทบรายเดือน ตรวจกับข้อกำหนด สปส. ก่อนยื่นจริง</p>
                    <button className="btn" disabled={!!busy} onClick={() => {
                      const f = makeEsso(computed, settings)
                      download(f.name, f.data)
                    }}>ดาวน์โหลดไฟล์ประกันสังคม</button>
                    <button className="btn ghost" type="button" onClick={() => setViewer('esso')}><span className="btn-ico" aria-hidden="true">👁</span> ดูตัวอย่าง</button>
                  </div>
                </div>
                {busy && (
                  <div style={{ marginTop: 16 }} role="status" aria-live="polite">
                    <div className="bar"><i style={{ width: `${pct}%` }} /></div>
                    <small>กำลังสร้าง {busy.done}/{busy.total}</small>
                  </div>
                )}
              </>
            )}
            </div></div>
          </section>
        </div>

        <aside className="preview" aria-label="ตัวอย่างสลิป">
          <p className="preview-cap">
            <span>ตัวอย่างสลิป</span>
            {dataOk && (
              <Select variant="pill" ariaLabel="เลือกพนักงานที่จะดูตัวอย่าง" value={String(safeIdx)} onChange={(v) => setPreviewIdx(Number(v))}
                options={computed.map((e, i) => ({ value: String(i), label: `${e.emp_id} ${e.full_name}` }))} />
            )}
          </p>
          {dataOk && (
            <div className="pager" role="group" aria-label="เลื่อนดูสลิปทีละคน">
              <button className="btn ghost" type="button" onClick={() => go(-1)} aria-label="คนก่อนหน้า">‹ ก่อนหน้า</button>
              <span aria-live="polite">{safeIdx + 1} / {count}</span>
              <button className="btn ghost" type="button" onClick={() => go(1)} aria-label="คนถัดไป">ถัดไป ›</button>
            </div>
          )}
          {dataOk && (
            <div
              className="zoomable" role="button" tabIndex={0} aria-label="ขยายตัวอย่างสลิปให้ใหญ่ขึ้น"
              onClick={() => setViewer('slips')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewer('slips') } }}
            >
              <div ref={canvasHost} />
              <span className="zoom-hint">🔍 คลิกเพื่อดูภาพใหญ่</span>
            </div>
          )}
          {!dataOk && <div className="empty-slip">ตัวอย่างสลิปจะแสดงที่นี่<br />หลังอัปโหลดและแก้ข้อมูลครบ</div>}
        </aside>
      </main>
      <ScrollTop hidden={!!viewer} />

      {zoom && dataOk && (
        <Viewer
          emps={computed}
          settings={settings}
          tab={viewer!}
          startIndex={safeIdx}
          bank={bank}
          onBank={setBank}
          onClose={(last) => { setPreviewIdx(last); setViewer(null) }}
        />
      )}
    </>
  )
}

/** Drop zone + live preview of the signature as it will print (background removed). */
function SignatureField(props: { value: string; name: string; onChange: (v: string) => void; onName: (v: string) => void }) {
  const { value, name, onChange, onName } = props
  const [over, setOver] = useState(false)
  const [err, setErr] = useState('')
  const [thumb, setThumb] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let off = false
    if (!value) { setThumb(''); return }
    loadSignature(value).then(() => { if (!off) setThumb(signaturePreview(value)) }).catch(() => {})
    return () => { off = true }
  }, [value])

  function take(f?: File) {
    if (!f) return
    setErr('')
    if (!f.type.startsWith('image/')) { setErr('ไฟล์นี้ไม่ใช่รูปภาพ'); return }
    if (f.size > 15 * 1024 * 1024) { setErr('รูปใหญ่เกิน 15 MB'); return }
    const r = new FileReader()
    r.onload = () => {
      const url = String(r.result)
      loadSignature(url).then(() => onChange(url))
        .catch(() => setErr('เบราว์เซอร์เปิดรูปชนิดนี้ไม่ได้ ลองแปลงเป็น PNG หรือ JPG'))
    }
    r.readAsDataURL(f)
  }

  return (
    <div className="sigbox">
      <div className="sig-head">
        <strong>ลายเซ็นบนสลิป</strong>
        <span>ไม่บังคับ — ไม่ใส่ก็จะเป็นเส้นว่างไว้เซ็นเอง</span>
      </div>
      <div className="sig-body">
        <div
          className={`sig-drop ${over ? 'over' : ''} ${thumb ? 'has' : ''}`}
          role="button" tabIndex={0}
          aria-label={thumb ? 'เปลี่ยนรูปลายเซ็น' : 'เลือกรูปลายเซ็น'}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]) }}
        >
          {thumb ? (
            <>
              <img src={thumb} alt="ลายเซ็นที่จะแสดงบนสลิป" />
              <span className="sig-change">คลิกเพื่อเปลี่ยนรูป</span>
            </>
          ) : (
            <>
              <span className="sig-icon" aria-hidden="true">✍</span>
              <b>ลากรูปลายเซ็นมาวาง</b>
              <span>หรือคลิกเลือกรูป · รองรับรูปทุกชนิด</span>
            </>
          )}
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <div className="sig-side">
          <div className="field">
            <label htmlFor="sn">ชื่อผู้เซ็น (แสดงใต้ลายเซ็น)</label>
            <input id="sn" value={name} placeholder="เช่น นายสมชาย ใจดี" onChange={(e) => onName(e.target.value)} />
          </div>
          {/* always rendered and folded with a height animation, so nothing below it jumps when the signature is added or removed */}
          <div className={`sig-fold ${thumb ? 'open' : ''}`}>
            <div className="sig-fold-in">
              <small>ลบพื้นหลังและตัดขอบให้อัตโนมัติแล้ว</small>
              <button className="link" type="button" tabIndex={thumb ? 0 : -1} onClick={() => onChange('')}>เอาลายเซ็นออก</button>
            </div>
          </div>
          <small>รูปอยู่ในเบราว์เซอร์เท่านั้น ไม่ถูกอัปโหลดไปไหน</small>
          {err && <small className="sig-err" role="alert">{err}</small>}
        </div>
      </div>
    </div>
  )
}

type Province = [string, Array<[string, string, Array<[string, string, number]>]>]
let provLoad: Promise<Province[]> | null = null
const loadProvinces = () => (provLoad ??= import('./data/thaiAddress.json').then((m) => m.default as unknown as Province[]))

/** Address textarea + popup that drills down: province → district → sub-district. Double-click to go deeper / choose. */
function AddressField(props: { value: string; onChange: (v: string) => void }) {
  const { value, onChange } = props
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<Province[] | null>(null)
  const [pi, setPi] = useState(-1)
  const [di, setDi] = useState(-1)
  const [q, setQ] = useState('')
  const [cur, setCur] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)

  // the box grows (and shrinks) with the address, smoothly; at least 3 lines
  const fit = () => {
    const el = ta.current
    if (!el) return
    const prev = el.offsetHeight
    el.style.height = 'auto'
    const next = el.scrollHeight + (el.offsetHeight - el.clientHeight)
    el.style.height = `${prev}px`
    void el.offsetHeight // commit the old height so the change below is animated
    el.style.height = `${next}px`
  }
  useLayoutEffect(fit, [value])
  useEffect(() => {
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useScrollLock(open)
  useEffect(() => { if (open && !data) loadProvinces().then(setData).catch(() => {}) }, [open, data])

  const prov = data && pi >= 0 ? data[pi] : null
  const dist = prov && di >= 0 ? prov[1][di] : null
  const level = !prov ? 0 : !dist ? 1 : 2
  const bkk = prov?.[0] === 'กรุงเทพมหานคร'

  // rows of the current level; idx = position in the unfiltered source array
  const rows = useMemo(() => {
    const t = q.trim()
    const keep = (s: string) => t === '' || t.split(/\s+/).every((w) => s.includes(w))
    if (!data) return []
    if (level === 0) return data.map((p, idx) => ({ idx, name: p[0], note: `${p[1].length} ${p[0] === 'กรุงเทพมหานคร' ? 'เขต' : 'อำเภอ'}` })).filter((r) => keep(r.name))
    if (level === 1) return prov!![1].map((d, idx) => ({ idx, name: `${d[1]}${d[0]}`, note: `${d[2].length} ${bkk ? 'แขวง' : 'ตำบล'}` })).filter((r) => keep(r.name))
    return dist!![2].map((s, idx) => ({ idx, name: `${s[1]}${s[0]}`, note: String(s[2]) })).filter((r) => keep(`${r.name} ${r.note}`))
  }, [data, level, prov, dist, bkk, q])

  useEffect(() => { setCur(0) }, [q, level])
  useEffect(() => { listRef.current?.children[cur]?.scrollIntoView({ block: 'nearest' }) }, [cur])

  const close = () => { setOpen(false); setPi(-1); setDi(-1); setQ('') }
  const back = () => { setQ(''); if (level === 2) setDi(-1); else if (level === 1) setPi(-1) }

  const choose = (r: { idx: number } | undefined) => {
    if (!r) return
    setQ('')
    if (level === 0) setPi(r.idx)
    else if (level === 1) setDi(r.idx)
    else {
      const s = dist![2][r.idx]
      const place = [`${s[1]}${s[0]}`, `${dist![1]}${dist![0]}`, bkk ? prov![0] : `จังหวัด${prov![0]}`, String(s[2])].join(' ')
      const base = value.replace(/[ \t]+$/, '')
      onChange(base === '' || base.endsWith('\n') ? base + place : `${base} ${place}`)
      close()
    }
  }

  const title = ['เลือกจังหวัด', `เลือก${prov?.[1][0]?.[1] ?? 'อำเภอ'}`, `เลือก${dist?.[2][0]?.[1] ?? 'ตำบล'}`][level]

  return (
    <>
      <label htmlFor="addr">ที่อยู่บริษัท (แสดงบนสลิป)</label>
      <textarea id="addr" ref={ta} rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder="พิมพ์เลขที่ ถนน ต่อท้ายได้เลย หรือกดปุ่มด้านล่างเพื่อเลือกจังหวัด อำเภอ ตำบล" />
      <div className="row">
        <button className="btn ghost" type="button" onClick={() => setOpen(true)}><span className="btn-ico" aria-hidden="true">📍</span> เลือกจากรายการที่อยู่</button>
      </div>

      {open && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="เลือกที่อยู่" onClick={close}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            else if (e.key === 'ArrowDown') { e.preventDefault(); setCur((c) => Math.min(c + 1, rows.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCur((c) => Math.max(c - 1, 0)) }
            else if (e.key === 'Enter' && rows.length) { e.preventDefault(); choose(rows[cur]) }
            else if (e.key === 'Backspace' && q === '' && level > 0) { e.preventDefault(); back() }
          }}>
          <div className="modal-in addr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-bar">
              <strong>{title}</strong>
              <button className="btn ghost" type="button" onClick={close}>ปิด (Esc)</button>
            </div>
            <nav className="crumbs" aria-label="ลำดับที่เลือก">
              <button type="button" className="link" onClick={() => { setPi(-1); setDi(-1); setQ('') }}>ทั้งหมด</button>
              {prov && <> › <button type="button" className="link" onClick={() => { setDi(-1); setQ('') }}>{prov[0]}</button></>}
              {dist && <> › <b>{dist[1]}{dist[0]}</b></>}
              {level > 0 && <button type="button" className="btn ghost crumb-back" onClick={back}>‹ ย้อนกลับ</button>}
            </nav>
            <div className="field">
              <label htmlFor="ad-q" className="sr-only">ค้นหา</label>
              <input id="ad-q" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์เพื่อกรองรายการ" />
            </div>
            <p className="addr-hint">
              {!data ? 'กำลังโหลดรายการที่อยู่…' : rows.length === 0 ? 'ไม่พบรายการ' : `${rows.length} รายการ · ดับเบิลคลิก${level === 2 ? 'เพื่อเลือก' : 'เพื่อไปต่อ'} (หรือ ↑ ↓ แล้วกด Enter)`}
            </p>
            <ul className="addr-list" ref={listRef} role="listbox" aria-label={title}>
              {rows.map((r, i) => (
                <li key={r.idx} role="option" aria-selected={i === cur} className={i === cur ? 'on' : ''}
                  onClick={() => setCur(i)} onDoubleClick={() => choose(r)}>
                  <b>{r.name}</b><span>{r.note}{level < 2 ? ' ›' : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}

/** Step title that doubles as the fold / unfold button. */
function StepHead(props: { n: number; title: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <h2>
      <button type="button" className="step-toggle" aria-expanded={!props.collapsed} onClick={props.onToggle}>
        <span className="num">{props.n}</span>
        <span className="step-title">{props.title}</span>
        <span className="chev" aria-hidden="true">▾</span>
      </button>
    </h2>
  )
}
