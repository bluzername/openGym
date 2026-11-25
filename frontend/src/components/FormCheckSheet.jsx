// Form check for squats, the sheets around the camera view (lib/form-check-native.js): a short
// "how to stand" with the camera to use, then what was measured: the reps, each one's depth and
// tempo, one summary line and one cue. It states measurements and never says whether the form
// was good. Nothing is kept; "Use N reps" is the only thing that reaches the workout.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { voiceOpts } from '../lib/speech.js'
import { formCheckAvailable, runSquatCheck } from '../lib/form-check-native.js'
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
  openSheet(close => <FormCheckIntro title={title} close={close} onStart={camera => {
    close()
    start(camera, title, onUse)
  }} />)
}

async function start(camera, title, onUse) {
  try {
    const result = await runSquatCheck({ camera, voice: voiceOpts(useStore.getState().S) })
    openSheet(close => <FormCheckResult result={result} title={title} close={close} onUse={onUse} />)
  } catch (e) {
    toast(e?.code === 'denied' ? t('Camera access is off. Allow it for openGym in the iPhone’s Settings.') : t('The camera could not start.'))
  }
}

export function FormCheckIntro({ title, close, onStart }) {
  const [camera, setCamera] = useState('back')
  return <div className="fc-sheet">
    <h3 style={{ marginBottom: 4 }}>{t('Form check')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{title}</div>
    <p className="fc-line">{t('Prop the phone up to your side and stand side-on, your whole body in the frame.')}</p>
    <p className="fc-line small muted">{t('Each rep is counted aloud. Nothing is filmed or kept: the camera is only read on this phone.')}</p>
    <Segmented className="seg-inline" value={camera} onChange={setCamera}
      options={[{ value: 'back', label: t('Back camera') }, { value: 'front', label: t('Front camera') }]} />
    <div className="fc-actions">
      <Button variant="primary" icon="camera" onClick={() => onStart(camera)}>{t('Start')}</Button>
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

export function FormCheckResult({ result, title, close, onUse }) {
  const { reps = [], summary = {}, cue = '' } = result || {}
  const n = summary.count || 0
  return <div className="fc-sheet" data-fc-result>
    <h3 style={{ marginBottom: 4 }}>{n ? tn('{0} rep', '{0} reps', n) : t('No reps counted')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{title ? t('Form check') + ' · ' + title : t('Form check')}</div>
    {n > 0 && <ol className="fc-reps">
      {reps.map((r, i) => <li key={i} className="fc-rep" data-fc-rep>
        <span className="fc-n">{t('Rep {0}', i + 1)}</span>
        <span className="fc-depth">{depthText(r.depth)}{r.minKnee != null && <span className="dim"> · {t('{0}° at the knee', r.minKnee)}</span>}</span>
        <span className="fc-tempo small muted">{t('Down {0} s · up {1} s', fmtNum(r.downSec), fmtNum(r.upSec))}{r.lean != null && ' · ' + t('Lean {0}°', r.lean)}</span>
        {r.lost && <span className="fc-lost small"><Icon name="info" />{t('Camera lost you')}</span>}
      </li>)}
    </ol>}
    {n > 0 && <p className="fc-line small" data-fc-summary>{summaryLine(summary)}</p>}
    <p className="fc-cue" data-fc-cue>{cue}</p>
    <p className="small dim fc-line">{t('Measured from a 2D side view: a guide, not a verdict.')}</p>
    <div className="fc-actions">
      {onUse && n > 0 && <Button variant="primary" onClick={() => { onUse(n); close() }}>{tn('Use {0} rep', 'Use {0} reps', n)}</Button>}
      <Button onClick={close}>{t('Close')}</Button>
    </div>
  </div>
}
