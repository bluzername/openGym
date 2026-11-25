// Form check for squats, the sheets around the camera view (lib/form-check-native.js): a short
// "how to stand" with the camera to use and the depth a rep counts from, then what was measured:
// the counted reps big with the no-reps under them, depth, tempo and consistency as tiles, the one
// cue as a callout, and every rep folded away below. It states measurements and never says
// whether the form was good. Nothing is kept; "Use N reps" is the only thing that reaches the
// workout, and it takes the counted reps only.
import { useEffect, useId, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { voiceOpts } from '../lib/speech.js'
import { formCheckAvailable, runSquatCheck } from '../lib/form-check-native.js'
import { depthShare } from '../lib/form-check.js'
import { storedStandard, storeStandard } from '../lib/form-check-standard.js'
import { Button, Segmented } from './ui.jsx'
import Icon from './Icon.jsx'

const openSheet = render => useUI.getState().openSheet(render)
const toast = m => useUI.getState().toast(m)

/** Whether to offer Form check at all: the iPhone app with a camera. Asked once per launch. */
export function useFormCheckAvailable() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    let live = true
    formCheckAvailable().then(v => { if (live) setOk(v) })
    return () => { live = false }
  }, [])
  return ok
}

/**
 * Opens the intro for `title` (the exercise's name). `onUse(n)`: writes n reps into the set in
 * progress; null leaves the button out.
 */
export function formCheckSheet({ title, onUse = null }) {
  openSheet(close => <FormCheckIntro title={title} close={close} onStart={(camera, standard) => {
    close()
    start(camera, standard, title, onUse)
  }} />)
}

async function start(camera, standard, title, onUse) {
  try {
    const result = await runSquatCheck({ camera, standard, drill: DRILL, voice: voiceOpts(useStore.getState().S) })
    openSheet(close => <FormCheckResult result={result} title={title} close={close} onUse={onUse} />)
  } catch (e) {
    toast(e?.code === 'denied' ? t('Camera access is off. Allow it for openGym in the iPhone’s Settings.') : t('The camera could not start.'))
  }
}

// The only drill so far; the next ones pass their own (lib/form-check.js DRILLS).
const DRILL = 'squat'

export function FormCheckIntro({ title, close, onStart }) {
  const [camera, setCamera] = useState('back')
  const [standard, setStandard] = useState(() => storedStandard(DRILL))
  const depthId = useId()
  const pickStandard = v => { setStandard(v); storeStandard(DRILL, v) }
  return <div className="fc-sheet">
    <h3 style={{ marginBottom: 4 }}>{t('Form check')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{title}</div>
    <p className="fc-line">{t('Prop the phone up to your side and stand side-on, your whole body in the frame.')}</p>
    <p className="fc-line small muted">{t('Each rep is counted aloud. Nothing is filmed or kept: the camera is only read on this phone.')}</p>
    <Segmented className="seg-inline" value={camera} onChange={setCamera}
      options={[{ value: 'back', label: t('Back camera') }, { value: 'front', label: t('Front camera') }]} />
    <div className="fc-pick" data-fc-standard>
      <div id={depthId} className="fc-pick-l small muted">{t('Counts from')}</div>
      <Segmented className="seg-inline" value={standard} onChange={pickStandard} ariaLabelledby={depthId}
        options={[{ value: 'parallel', label: t('Parallel') }, { value: 'below', label: t('Below parallel') }, { value: 'any', label: t('Any depth') }]} />
    </div>
    <div className="fc-actions">
      <Button variant="primary" icon="camera" onClick={() => onStart(camera, standard)}>{t('Start')}</Button>
      <Button onClick={close}>{t('Cancel')}</Button>
    </div>
  </div>
}

const DEPTH = { below: () => t('Below parallel'), parallel: () => t('Parallel'), above: () => t('Above parallel') }
const depthText = d => (DEPTH[d] ? DEPTH[d]() : t('Depth not seen'))

/** The facts of the set as one line: depth counts, average tempo, the most lean, the spread. */
export function summaryLine(s) {
  if (!s || !s.count) return ''
  const parts = []
  const depth = [
    s.depthBelow && t('{0} below parallel', s.depthBelow),
    s.depthParallel && t('{0} at parallel', s.depthParallel),
    s.depthAbove && t('{0} above parallel', s.depthAbove),
  ].filter(Boolean)
  if (depth.length) parts.push(depth.join(', '))
  if (s.avgDown != null) parts.push(t('Down {0} s and up {1} s on average', fmtNum(s.avgDown), fmtNum(s.avgUp)))
  if (s.maxLean != null) parts.push(t('Torso lean up to {0}°', s.maxLean))
  if (s.consistency != null) parts.push(t('Bottom knee angle varied by {0}°', s.consistency))
  return parts.join('. ') + '.'
}

// The tiles under the count, the ones the set has figures for: how deep every rep went (no-reps
// included), the average tempo of the counted ones, and their spread at the bottom, or the most
// lean when a single rep has no spread.
function resultTiles(result) {
  const { reps = [], summary: s = {}, standard } = result
  const out = []
  const share = depthShare(reps, standard)
  if (share.of) out.push({ id: 'depth', l: t('Depth'), v: t('{0} of {1}', share.hit, share.of), sub: share.depth === 'below' ? t('below parallel') : t('at parallel or deeper') })
  if (s.avgDown != null) out.push({ id: 'tempo', l: t('Tempo'), v: t('{0} / {1} s', fmtNum(s.avgDown), fmtNum(s.avgUp)), sub: t('down / up, on average') })
  if (s.consistency != null) out.push({ id: 'consistency', l: t('Consistency'), v: s.consistency + '°', sub: t('spread at the bottom') })
  else if (s.maxLean != null) out.push({ id: 'lean', l: t('Lean'), v: s.maxLean + '°', sub: t('torso lean at most') })
  return out
}

export function FormCheckResult({ result, title, close, onUse }) {
  const { reps = [], summary = {}, cue = '' } = result || {}
  const n = summary.count || 0
  const missed = summary.missed || 0
  const [open, setOpen] = useState(false)
  const tiles = resultTiles(result || {})
  return <div className="fc-sheet" data-fc-result>
    <h3 style={{ marginBottom: 4 }}>{t('Form check')}</h3>
    {title && <div className="muted small">{title}</div>}
    <div className="fc-hero" data-fc-hero>
      <b className="fc-hero-n" data-fc-count>{n}</b>
      <span className="fc-hero-l">{t('Counted reps')}</span>
      {missed > 0 && <span className="fc-hero-miss" data-fc-missed>{t('{0} did not count', missed)}</span>}
    </div>
    {tiles.length > 0 && <div className="tiles fc-tiles">
      {tiles.map(x => <div key={x.id} className="tile" data-fc-tile={x.id}>
        <div className="l">{x.l}</div>
        <div className="v">{x.v}</div>
        <div className="fc-tile-s">{x.sub}</div>
      </div>)}
    </div>}
    <div className="fc-callout" data-fc-cue><Icon name={result?.cueId === 'missed' ? 'warning' : 'lightbulb'} /><p>{cue}</p></div>
    {reps.length > 0 && <>
      <Button className="fc-more" trailingIcon={open ? 'chevronUp' : 'chevronDown'} aria-expanded={open} onClick={() => setOpen(o => !o)}>{t('Every rep')}</Button>
      {open && <>
        <ol className="fc-reps">
          {reps.map((r, i) => <li key={i} className={'fc-rep' + (r.counted === false ? ' missed' : '')} data-fc-rep>
            <span className="fc-n">{t('Rep {0}', i + 1)}</span>
            <span className="fc-depth">{depthText(r.depth)}{r.minKnee != null && <span className="dim"> · {t('{0}° at the knee', r.minKnee)}</span>}</span>
            <span className="fc-tempo small muted">{t('Down {0} s · up {1} s', fmtNum(r.downSec), fmtNum(r.upSec))}{r.lean != null && ' · ' + t('Lean {0}°', r.lean)}</span>
            {r.counted === false && <span className="fc-flag fc-miss small"><Icon name="xmark" />{t('Not counted: too shallow')}</span>}
            {r.lost && <span className="fc-flag fc-lost small"><Icon name="info" />{t('Camera lost you')}</span>}
          </li>)}
        </ol>
        {n > 0 && <p className="fc-line small" data-fc-summary>{summaryLine(summary)}</p>}
      </>}
    </>}
    <p className="small dim fc-line">{t('Measured from a 2D side view: a guide, not a verdict.')}</p>
    <div className="fc-actions">
      {onUse && n > 0 && <Button variant="primary" onClick={() => { onUse(n); close() }}>{tn('Use {0} rep', 'Use {0} reps', n)}</Button>}
      <Button onClick={close}>{t('Close')}</Button>
    </div>
  </div>
}
