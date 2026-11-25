// Form check, the sheets around the camera view (lib/form-check-native.js), for any drill
// (lib/form-drills/): a short "how to stand" from the drill's setup with the camera to use and
// the standard a rep counts from, then what was measured: the counted reps (or the seconds held)
// big with the no-reps under them, the drill's two or three tiles, its one cue as a callout, and
// every rep folded away below. It states measurements and never says whether the form was good.
// Nothing is kept; "Use N reps" is the only thing that reaches the workout, and it takes the
// counted reps only.
import { useEffect, useId, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { voiceOpts } from '../lib/speech.js'
import { formCheckAvailable, runFormCheck } from '../lib/form-check-native.js'
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
 * Opens the intro of `drill` (lib/form-drills/) for `title` (the exercise's name). `onUse(n)`:
 * writes n reps into the set in progress; null leaves the button out.
 */
export function formCheckSheet({ title, drill, onUse = null }) {
  openSheet(close => <FormCheckIntro title={title} drill={drill} close={close} onStart={(camera, standard) => {
    close()
    start(drill, camera, standard, title, onUse)
  }} />)
}

async function start(drill, camera, standard, title, onUse) {
  try {
    const result = await runFormCheck({ drill: drill.id, camera, standard, voice: voiceOpts(useStore.getState().S) })
    openSheet(close => <FormCheckResult result={result} drill={drill} title={title} close={close} onUse={onUse} />)
  } catch (e) {
    toast(e?.code === 'denied' ? t('Camera access is off. Allow it for openGym in the iPhone’s Settings.') : t('The camera could not start.'))
  }
}

export function FormCheckIntro({ title, drill, close, onStart }) {
  const [camera, setCamera] = useState('back')
  const [standard, setStandard] = useState(() => storedStandard(drill.id) || drill.defaultStandard)
  const depthId = useId()
  const pickStandard = v => { setStandard(v); storeStandard(drill.id, v) }
  return <div className="fc-sheet">
    <h3 style={{ marginBottom: 4 }}>{t('Form check')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{title}</div>
    <p className="fc-line" data-fc-setup>{t(drill.setup)}</p>
    <p className="fc-line small muted">{t('Each rep is counted aloud. Nothing is filmed or kept: the camera is only read on this phone.')}</p>
    <Segmented className="seg-inline" value={camera} onChange={setCamera}
      options={[{ value: 'back', label: t('Back camera') }, { value: 'front', label: t('Front camera') }]} />
    {drill.standards.length > 1 && <div className="fc-pick" data-fc-standard>
      <div id={depthId} className="fc-pick-l small muted">{t('Counts from')}</div>
      <Segmented className="seg-inline" value={standard} onChange={pickStandard} ariaLabelledby={depthId}
        options={drill.standards.map(s => ({ value: s.id, label: t(s.label) }))} />
    </div>}
    <div className="fc-actions">
      <Button variant="primary" icon="camera" onClick={() => onStart(camera, standard)}>{t('Start')}</Button>
      <Button onClick={close}>{t('Cancel')}</Button>
    </div>
  </div>
}

export function FormCheckResult({ result, drill, title, close, onUse }) {
  const { reps = [], tiles = [], details = [], cue = '', cueId, note = '' } = result || {}
  const n = result?.count || 0
  const missed = result?.missed || 0
  const hold = drill?.kind === 'hold'
  const [open, setOpen] = useState(false)
  const missRow = r => {
    const m = drill?.misses?.[r.reason]
    return m ? t(m.row) : t('Not counted')
  }
  return <div className="fc-sheet" data-fc-result>
    <h3 style={{ marginBottom: 4 }}>{t('Form check')}</h3>
    {title && <div className="muted small">{title}</div>}
    <div className="fc-hero" data-fc-hero>
      <b className="fc-hero-n" data-fc-count>{n}</b>
      <span className="fc-hero-l">{hold ? t('Seconds held in position') : t('Counted reps')}</span>
      {missed > 0 && <span className="fc-hero-miss" data-fc-missed>{t('{0} did not count', missed)}</span>}
    </div>
    {tiles.length > 0 && <div className="tiles fc-tiles">
      {tiles.map(x => <div key={x.id || x.label} className="tile" data-fc-tile={x.id || x.label}>
        <div className="l">{x.label}</div>
        <div className="v">{x.value}</div>
        {x.sub && <div className="fc-tile-s">{x.sub}</div>}
      </div>)}
    </div>}
    <div className="fc-callout" data-fc-cue><Icon name={cueId === 'missed' ? 'warning' : 'lightbulb'} /><p>{cue}</p></div>
    {reps.length > 0 && <>
      <Button className="fc-more" trailingIcon={open ? 'chevronUp' : 'chevronDown'} aria-expanded={open} onClick={() => setOpen(o => !o)}>{t('Every rep')}</Button>
      {open && <>
        <ol className="fc-reps">
          {reps.map((r, i) => <li key={i} className={'fc-rep' + (r.counted === false ? ' missed' : '')} data-fc-rep>
            <span className="fc-n">{t('Rep {0}', i + 1)}</span>
            <span className="fc-rows">{(details[i] || []).map((d, k) => <span key={k} className="fc-row small"><span className="muted">{d.label}</span> {d.value}</span>)}</span>
            {r.counted === false && <span className="fc-flag fc-miss small"><Icon name="xmark" />{missRow(r)}</span>}
            {r.lost && <span className="fc-flag fc-lost small"><Icon name="info" />{t('Camera lost you')}</span>}
          </li>)}
        </ol>
        {note && <p className="fc-line small" data-fc-note>{note}</p>}
      </>}
    </>}
    <p className="small dim fc-line">{t('Measured from a 2D camera view: a guide, not a verdict.')}</p>
    <div className="fc-actions">
      {onUse && !hold && n > 0 && <Button variant="primary" onClick={() => { onUse(n); close() }}>{tn('Use {0} rep', 'Use {0} reps', n)}</Button>}
      <Button onClick={close}>{t('Close')}</Button>
    </div>
  </div>
}
