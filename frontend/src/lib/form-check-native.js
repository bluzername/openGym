// The page's side of Form check (FormCheckPlugin.swift, lib/form-check.js). The iPhone app shows
// the camera full screen with the skeleton over it and sends the pose about 15 times a second;
// this feeds the poses to the tracker, tells the native view what to say on its status line,
// says each rep's number aloud, and hands back the tracker's result once the view closes.
// A rep that did not meet the lifter's standard is said too ("Too shallow"), flashed red with a
// buzz, and its reason stays on the status line for MISS_SHOW_MS; the count does not move.
// Nothing is filmed or kept: the frames never leave the native side, only joint positions do.
//
// iPhone only. Anywhere else (the web, Android, a build without the plugin, the simulator, which
// has no camera) formCheckAvailable() resolves false and nothing offers it.
import { MOBILE } from './mobile.js'
import { t } from './i18n-core.js'
import { speak } from './speech.js'
import { createTracker, framing } from './form-check.js'

/** How long the status line shows why a rep did not count, in ms of the pose clock. */
export const MISS_SHOW_MS = 2000

// Registered once and handed out inside an object: a Capacitor plugin proxy answers `then` with a
// native call that never settles, so a promise resolved with the bare proxy hangs (#42).
let pluginP = null
const formPlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  const { registerPlugin, Capacitor } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'ios') return null
  if (typeof Capacitor.isPluginAvailable === 'function' && !Capacitor.isPluginAvailable('FormCheck')) return null
  return { FormCheck: registerPlugin('FormCheck') }
})().catch(() => null))

let availableP = null
/** Whether this phone can run a form check: the iPhone app with the plugin and a camera. */
export function formCheckAvailable() {
  return availableP || (availableP = formPlugin()
    .then(p => (p ? p.FormCheck.available() : null))
    .then(res => !!(res && res.available === true))
    .catch(() => false))
}

/** What the status line says while the pose cannot be judged (lib/form-check.js framing). */
export function framingHint(reason) {
  switch (reason) {
    case 'none': return t('Step into the frame')
    case 'partial': return t('Get your whole body in the frame')
    case 'facing': return t('Turn side-on to the camera')
    case 'far': return t('Come a little closer')
    default: return ''
  }
}

/** The status line for a rep that did not count, by its reason (lib/form-check.js). */
export function missedHint(reason) {
  return reason === 'shallow' ? t('Too shallow. Not counted.') : t('Not counted')
}
// What is said aloud for it: as short as a rep's number.
const missedSay = () => t('Too shallow')

/**
 * Starts the camera view and resolves with the tracker's result when the lifter taps Done.
 * `voice`: lib/speech.js voiceOpts(S). Each rep is said even with Spoken cues off: the phone is
 * propped up out of reach. `drill` and `standard`: lib/form-check.js DRILLS, the standard a rep
 * must meet to count (the drill's default when left out). Rejects when the view cannot open (no
 * camera access, no plugin).
 */
export async function runSquatCheck({ camera = 'back', onUpdate, voice = {}, drill = 'squat', standard } = {}) {
  const p = await formPlugin()
  if (!p) throw new Error('unavailable')
  const { FormCheck } = p
  const tracker = createTracker({ drill, standard })
  let shown = null
  let missUntil = -1, missText = ''
  const subs = []
  const drop = () => { for (const s of subs) Promise.resolve(s).then(h => h && h.remove && h.remove()).catch(() => {}) }

  const onPose = frame => {
    const now = tracker.push(frame)
    const at = Number(frame && frame.t) || 0
    if (now.justMissed) { missUntil = at + MISS_SHOW_MS; missText = missedHint(now.reason) }
    const why = framing(frame)
    const text = why ? framingHint(why)
      : at < missUntil ? missText
        : now.phase === 'waiting' ? t('Stand tall to start')
          : now.reps ? '' : t('Ready. Squat when you are.')
    // The bridge is only crossed when the line, the count or the depth reached changes, not 15
    // times a second. `reached`: the rep under way already meets the standard (the hip lights up).
    const key = text + '|' + now.reps + '|' + now.reached
    if (key !== shown) {
      shown = key
      FormCheck.setStatus({ text, reps: now.reps, reached: now.reached }).catch(() => {})
    }
    // A number cuts off whatever is still being said, so it is never late; a no-rep is queued
    // behind it instead, so it never talks over one. feedback() is the flash and the buzz; a
    // build without it just rejects.
    if (now.justCounted) {
      speak(String(now.reps), { ...voice, onSilent: true, queue: false }).catch?.(() => {})
      FormCheck.feedback?.({ kind: 'counted' })?.catch?.(() => {})
    }
    if (now.justMissed) {
      speak(missedSay(now.reason), { ...voice, onSilent: true, queue: true }).catch?.(() => {})
      FormCheck.feedback?.({ kind: 'missed', text: missText })?.catch?.(() => {})
    }
    if (onUpdate) onUpdate({ ...now, hint: text })
  }

  return new Promise((resolve, reject) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      drop()
      resolve(tracker.result())
    }
    subs.push(FormCheck.addListener('pose', onPose))
    subs.push(FormCheck.addListener('closed', finish))
    // The native view's own words come from here, in the app's language.
    const labels = { done: t('Done'), flip: t('Switch camera') }
    FormCheck.start({ camera: camera === 'front' ? 'front' : 'back', labels }).catch(e => {
      if (done) return
      done = true
      drop()
      reject(e)
    })
  })
}

/** Closes the camera view from the page (the result still arrives through runSquatCheck). */
export function stopSquatCheck() {
  return formPlugin().then(p => (p ? p.FormCheck.stop() : null)).catch(() => null)
}

// Test seam: a fresh launch.
export function _resetFormCheck() { pluginP = null; availableP = null }
