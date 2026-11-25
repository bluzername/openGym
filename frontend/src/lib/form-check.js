// Form check for squats (FormCheckPlugin.swift films, this reads): the 2D body pose of a lifter
// filmed side-on, frame by frame, turned into reps and a few measured facts per rep. It measures,
// it never grades: depth is where the hip was against the knee, tempo is seconds, lean is degrees.
//
// A frame is { t: ms, aspect: width / height of the image, joints: { leftHip: [x, y, conf], ... } }
// in normalised image coordinates, y growing downward. x is stretched by `aspect` before any
// angle is taken, or an upright 3:4 image would bend every knee.
//
// The knee angle (hip-knee-ankle, 180 straight) drives a small state machine:
//   waiting -> standing -> descending -> bottom -> ascending -> standing (a rep)
// It waits until the lifter has stood up once, so setting up under the bar is not a rep, and a
// rep counts only when the knee bent past MIN_REP_ANGLE on the way, so a wobble at the top is not.
import { t } from './i18n-core.js'

export const MIN_CONF = 0.25
export const STAND_ANGLE = 160         // at or above: standing
export const DESCENT_ANGLE = 150       // below, from standing: on the way down
export const MIN_REP_ANGLE = 125       // the knee must bend past this for a rep to count
export const BOTTOM_EPS = 3            // degrees back up from the lowest point: at the bottom
export const ASCENT_RISE = 12          // degrees back up from the lowest point: on the way up
export const TOP_BAND = 5              // within this of the standing angle: still at the top
export const SMOOTH = 0.5              // weight of the newest angle in the running average
export const GAP_MS = 400              // a longer gap between seen frames is a lost pose
export const LOST_RESET_MS = 2500      // lost this long mid-rep: the rep is dropped
export const PARALLEL_BAND = 0.1       // hip within this many thigh lengths of the knee: parallel
export const FAST_DOWN_SEC = 1         // an average way down under this: "slow the way down"
export const FADE_DEG = 12             // last reps' bottom this much higher than the first ones'
export const FACING_SPREAD = 0.5       // hips this many thigh lengths apart: facing the camera
export const FAR_HEIGHT = 0.35         // shoulder to ankle under this share of the frame: too far
const SIDE_SMOOTH = 0.2

const CHAIN = ['Hip', 'Knee', 'Ankle']

const seen = (joints, name) => {
  const j = joints && joints[name]
  return Array.isArray(j) && j.length >= 2 && Number.isFinite(j[0]) && Number.isFinite(j[1]) && (j[2] ?? 1) >= MIN_CONF ? j : null
}
const chainConf = (joints, side) => {
  let c = 1
  for (const k of CHAIN) {
    const j = seen(joints, side + k)
    if (!j) return 0
    c = Math.min(c, j[2] ?? 1)
  }
  return c
}
const deg = r => r * 180 / Math.PI
const dist = (a, b, aspect) => Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1])

/** The side ('left' | 'right') whose hip, knee and ankle are all seen, the better one; null if neither. */
export function pickSide(joints) {
  const l = chainConf(joints, 'left'), r = chainConf(joints, 'right')
  if (!l && !r) return null
  return l >= r ? 'left' : 'right'
}

/** The hip-knee-ankle angle in degrees on one side, null when one of the three is not seen. */
export function kneeAngle(joints, side, aspect = 1) {
  const h = seen(joints, side + 'Hip'), k = seen(joints, side + 'Knee'), a = seen(joints, side + 'Ankle')
  if (!h || !k || !a) return null
  const ux = (h[0] - k[0]) * aspect, uy = h[1] - k[1], vx = (a[0] - k[0]) * aspect, vy = a[1] - k[1]
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy)
  if (!(n > 0)) return null
  return deg(Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n))))
}

// How far the hip sat below the knee, in thigh lengths (positive: below).
function hipDrop(joints, side, aspect) {
  const h = seen(joints, side + 'Hip'), k = seen(joints, side + 'Knee')
  const len = h && k ? dist(h, k, aspect) : 0
  return len > 0 ? (h[1] - k[1]) / len : null
}

// The torso's angle from vertical (shoulder over hip), with the other shoulder as a stand-in.
function torsoLean(joints, side, aspect) {
  const other = side === 'left' ? 'right' : 'left'
  const s = seen(joints, side + 'Shoulder') || seen(joints, other + 'Shoulder')
  const h = seen(joints, side + 'Hip')
  if (!s || !h) return null
  return deg(Math.atan2(Math.abs((s[0] - h[0]) * aspect), Math.abs(s[1] - h[1])))
}

/**
 * Why a frame cannot be judged yet, for the status line: 'none' (nobody there), 'partial' (hip,
 * knee and ankle of neither side, or no shoulder), 'facing' (front-on, not side-on), 'far' (too
 * small in the frame). null when it can be.
 */
export function framing(frame) {
  const joints = frame && frame.joints
  if (!joints || !Object.keys(joints).some(k => seen(joints, k))) return 'none'
  const aspect = frame.aspect > 0 ? frame.aspect : 1
  const side = pickSide(joints)
  if (!side) return 'partial'
  const shoulders = ['leftShoulder', 'rightShoulder'].map(k => seen(joints, k)).filter(Boolean)
  if (!shoulders.length) return 'partial'
  const lh = seen(joints, 'leftHip'), rh = seen(joints, 'rightHip')
  const thigh = dist(seen(joints, side + 'Hip'), seen(joints, side + 'Knee'), aspect)
  if (lh && rh && thigh > 0 && Math.abs(lh[0] - rh[0]) * aspect / thigh > FACING_SPREAD) return 'facing'
  const ankles = ['leftAnkle', 'rightAnkle'].map(k => seen(joints, k)).filter(Boolean)
  const height = Math.max(...ankles.map(a => a[1])) - Math.min(...shoulders.map(s => s[1]))
  if (height < FAR_HEIGHT) return 'far'
  return null
}

const round1 = n => Math.round(n * 10) / 10
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length

/** The one sentence a result ends with, by its id. Functions, so they read the language at call time. */
export const CUE = {
  none: () => t('No reps were counted. Stand side-on with your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Stand side-on with your whole body in the frame.'),
  deeper: () => t('Most reps stopped above parallel. Try sitting a little deeper.'),
  slower: () => t('The way down took under a second. Try slowing the descent.'),
  fade: () => t('The last reps were shallower than the first ones.'),
  steady: () => t('Depth and tempo held steady across the set.'),
}

function pickCue(reps) {
  const n = reps.length
  if (!n) return 'none'
  if (reps.filter(r => r.lost).length * 2 > n) return 'framing'
  if (reps.filter(r => r.depth === 'above').length * 2 > n) return 'deeper'
  if (mean(reps.map(r => r.downSec)) < FAST_DOWN_SEC) return 'slower'
  if (n >= 4) {
    const k = Math.ceil(n / 3)
    const first = mean(reps.slice(0, k).map(r => r.minKnee)), last = mean(reps.slice(-k).map(r => r.minKnee))
    if (last - first > FADE_DEG) return 'fade'
  }
  return 'steady'
}

function summarise(reps) {
  const n = reps.length
  const depthOf = d => reps.filter(r => r.depth === d).length
  const bottoms = reps.map(r => r.minKnee)
  const leans = reps.map(r => r.lean).filter(x => x != null)
  return {
    count: n,
    depthBelow: depthOf('below'),
    depthParallel: depthOf('parallel'),
    depthAbove: depthOf('above'),
    avgDown: n ? round1(mean(reps.map(r => r.downSec))) : null,
    avgUp: n ? round1(mean(reps.map(r => r.upSec))) : null,
    maxLean: leans.length ? Math.max(...leans) : null,
    // The spread of the bottom knee angle across the set, in degrees.
    consistency: n >= 2 ? Math.round(Math.max(...bottoms) - Math.min(...bottoms)) : null,
  }
}

/**
 * A live tracker: push(frame) -> { reps, phase, inFrame, justCounted } per frame, result() ->
 * { reps: [{ depth, minKnee, downSec, upSec, lean, lost }], summary, cue, cueId } at any time.
 */
export function createSquatTracker() {
  const reps = []
  const conf = { left: 0, right: 0 }
  let phase = 'waiting'
  let angle = null           // smoothed knee angle
  let lastSeenT = null
  let topRef = 0             // the standing angle, the highest while standing
  let topT = 0               // the last moment still at the top, where a descent starts
  let rep = null             // the rep under way
  let closing = null         // a counted rep whose way up is still being timed

  const closeUp = at => { if (closing) { closing.upSec = round1(Math.max(0, at - closing.bottomT) / 1000); closing = null } }

  function track(joints, side, aspect, raw, t) {
    if (raw < rep.rawMin) rep.rawMin = raw
    const d = hipDrop(joints, side, aspect)
    if (d != null && (rep.drop == null || d > rep.drop)) rep.drop = d
    const l = torsoLean(joints, side, aspect)
    if (l != null && (rep.lean == null || l > rep.lean)) rep.lean = l
    if (angle < rep.min) { rep.min = angle; rep.bottomT = t }
  }

  function count(t) {
    const depth = rep.drop == null ? null : rep.drop > PARALLEL_BAND ? 'below' : rep.drop < -PARALLEL_BAND ? 'above' : 'parallel'
    const done = {
      depth,
      minKnee: Math.round(rep.rawMin),
      downSec: round1(Math.max(0, rep.bottomT - rep.startT) / 1000),
      upSec: round1(Math.max(0, t - rep.bottomT) / 1000),
      lean: rep.lean == null ? null : Math.round(rep.lean),
      lost: rep.lost,
      bottomT: rep.bottomT,
      ref: rep.ref,
    }
    reps.push(done)
    closing = done
  }

  function push(frame) {
    const t = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const aspect = frame && frame.aspect > 0 ? frame.aspect : 1
    for (const s of ['left', 'right']) conf[s] += SIDE_SMOOTH * (chainConf(joints, s) - conf[s])
    const side = conf.left >= conf.right ? 'left' : 'right'
    const raw = kneeAngle(joints, side, aspect)
    let justCounted = false
    const out = inFrame => ({ reps: reps.length, phase, inFrame, justCounted })

    if (raw == null) {
      if (rep) {
        rep.lost = true
        if (lastSeenT != null && t - lastSeenT > LOST_RESET_MS) { rep = null; phase = 'waiting' }
      }
      return out(false)
    }
    if (rep && lastSeenT != null && t - lastSeenT > LOST_RESET_MS) { rep = null; phase = 'waiting' }
    if (rep && lastSeenT != null && t - lastSeenT > GAP_MS) rep.lost = true
    angle = angle == null || lastSeenT == null || t - lastSeenT > GAP_MS ? raw : angle + SMOOTH * (raw - angle)
    lastSeenT = t

    if (phase === 'waiting') {
      if (angle >= STAND_ANGLE) { phase = 'standing'; topRef = angle; topT = t }
      return out(true)
    }
    if (phase === 'standing') {
      if (angle > topRef) topRef = angle
      if (angle >= topRef - TOP_BAND) topT = t
      if (closing && angle >= closing.ref - TOP_BAND) closeUp(t)
      if (angle < DESCENT_ANGLE) {
        closeUp(topT)
        phase = 'descending'
        rep = { startT: topT, ref: topRef, min: angle, bottomT: t, rawMin: raw, drop: null, lean: null, lost: false }
        track(joints, side, aspect, raw, t)
      }
      return out(true)
    }
    track(joints, side, aspect, raw, t)
    if (phase === 'descending') {
      if (angle > rep.min + ASCENT_RISE) phase = 'ascending'
      else if (angle > rep.min + BOTTOM_EPS) phase = 'bottom'
    } else if (phase === 'bottom') {
      if (angle <= rep.min) phase = 'descending'
      else if (angle > rep.min + ASCENT_RISE) phase = 'ascending'
    } else if (phase === 'ascending' && angle <= rep.min) phase = 'descending'
    if (phase === 'ascending' && angle >= STAND_ANGLE) {
      if (rep.rawMin < MIN_REP_ANGLE) { count(t); justCounted = true }
      rep = null
      phase = 'standing'
      topRef = angle
      topT = t
    }
    return out(true)
  }

  function result() {
    const list = reps.map(({ bottomT, ref, ...r }) => r)
    const cueId = pickCue(list)
    return { reps: list, summary: summarise(list), cue: CUE[cueId](), cueId }
  }

  return { push, result }
}
