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
// descent is a rep only when the knee bent past MIN_REP_ANGLE on the way, so a wobble at the top is
// not. A rep then counts when it met the lifter's standard (DRILLS: parallel, below or any depth);
// one that did not is kept as a no-rep, flagged, and left out of the count.
//
// The drill (DRILLS) brings what is particular to a movement: the angle the reps are read from and
// its thresholds, how deep a frame went, the names of depth and the standards. The state machine
// and the result are shared, so a second drill is a new entry with its own functions.
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

// The squats Form check is offered for: a few by id, and any two-legged squat by its name. One leg
// at a time (split, pistol, skater), jumps, holds and combinations (squat to press, squat row) are
// left out: the rep is not a single bend and stand of both knees.
export const SQUAT_IDS = new Set(['3593', '2966', '0043'])
const NOT_A_PLAIN_SQUAT = /split|single leg|one leg|pistol|skater|cossack|curtsey|side squat|jump|hold|row|curl|press|punch|chin up|sissy|wall|lunge|calf|form check|knees|kneeling|deadlift|pallof|twist|chop/i
const SQUAT_CATS = new Set(['strength', 'calisthenics'])

/** Whether an exercise ({ id, n, cat }) is a plain squat Form check can count. */
export function isSquatPattern(ex) {
  if (!ex || typeof ex !== 'object') return false
  if (SQUAT_IDS.has(ex.id)) return true
  const name = String(ex.n || '')
  if (!/\bsquat/i.test(name) || NOT_A_PLAIN_SQUAT.test(name)) return false
  return !ex.cat || SQUAT_CATS.has(ex.cat)
}

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

// A squat's depth from how far the hip sat below the knee (hipDrop, thigh lengths).
const squatDepth = drop => (drop == null ? null : drop > PARALLEL_BAND ? 'below' : drop < -PARALLEL_BAND ? 'above' : 'parallel')

const round1 = n => Math.round(n * 10) / 10
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length

/** The one sentence a result ends with, by its id. Functions, so they read the language at call time. */
export const CUE = {
  // A no-rep: said first, whatever else the set showed. `n` no-reps under `standard`.
  missed: (n, standard) => (standard === 'below'
    ? t('Reps that did not count: {0}. The hip did not get below the knee.', n)
    : t('Reps that did not count: {0}. The hip stayed above the knee.', n)),
  none: () => t('No reps were counted. Stand side-on with your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Stand side-on with your whole body in the frame.'),
  deeper: () => t('Most reps stopped above parallel. Try sitting a little deeper.'),
  slower: () => t('The way down took under a second. Try slowing the descent.'),
  fade: () => t('The last reps were shallower than the first ones.'),
  steady: () => t('Depth and tempo held steady across the set.'),
}

/**
 * The drills Form check can count. Each: `standards` (the lowest a rep may stop and still count,
 * the lifter's choice) and `defaultStandard`; `angle(joints, side, aspect)` the angle the reps are
 * read from (180 straight, smaller bent) with `stand`, `descent` and `minRep` thresholds;
 * `reach(joints, side, aspect)` how deep a frame went (bigger deeper), `depth(reach)` its name, and
 * `meets(depth, standard)`; `lean` an optional extra measure; `cues` the result's sentences.
 */
export const DRILLS = {
  squat: {
    id: 'squat',
    standards: ['parallel', 'below', 'any'],
    defaultStandard: 'parallel',
    angle: (joints, side, aspect) => kneeAngle(joints, side, aspect),
    stand: STAND_ANGLE,
    descent: DESCENT_ANGLE,
    minRep: MIN_REP_ANGLE,
    reach: (joints, side, aspect) => hipDrop(joints, side, aspect),
    depth: squatDepth,
    // parallel: the hip came to knee height, within PARALLEL_BAND; below: clearly under it; any:
    // every real descent. A depth never seen (no hip or knee at the bottom) is given the rep.
    meets: (depth, standard) => standard === 'any' || depth == null || (standard === 'below' ? depth === 'below' : depth !== 'above'),
    lean: (joints, side, aspect) => torsoLean(joints, side, aspect),
    cues: CUE,
  },
}

/** The drill's standard: `standard` when it is one of the drill's, else its default. */
export function standardFor(drillId, standard) {
  const drill = DRILLS[drillId]
  if (!drill) return null
  return drill.standards.includes(standard) ? standard : drill.defaultStandard
}

// `reps`: the counted ones; no-reps come first.
function pickCue(reps, missed) {
  if (missed) return 'missed'
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

// Every figure but `missed` is over the counted reps only: a no-rep's depth and tempo are not the
// set's. depthShare() reads all of them, no-reps included, for the depth they reached.
function summarise(reps, missed) {
  const n = reps.length
  const depthOf = d => reps.filter(r => r.depth === d).length
  const bottoms = reps.map(r => r.minKnee)
  const leans = reps.map(r => r.lean).filter(x => x != null)
  return {
    count: n,
    missed,
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
 * Of every rep, no-reps included, how many reached the depth a result talks about: below parallel
 * under the 'below' standard, parallel or deeper otherwise. { hit, of, depth: 'below' | 'parallel' }.
 */
export function depthShare(reps, standard) {
  const list = Array.isArray(reps) ? reps : []
  const depth = standard === 'below' ? 'below' : 'parallel'
  const hit = list.filter(r => r.depth === 'below' || (depth === 'parallel' && r.depth === 'parallel')).length
  return { hit, of: list.length, depth }
}

/**
 * A live tracker for one drill (DRILLS) and the lifter's standard, by default the drill's own.
 * push(frame) -> { reps, phase, inFrame, justCounted, justMissed, reason, reached } per frame:
 * `reps` is the counted ones, `justMissed` (with `reason`, 'shallow') is set on the frame a
 * no-rep ends, the way `justCounted` is on a counted one, and `reached` says the rep under way has
 * already met the standard. result() -> { reps: [{ depth, minKnee, downSec, upSec, lean, lost,
 * counted, reason }], summary, cue, cueId, drill, standard } at any time.
 *
 * A rep the camera lost for a moment (shorter than LOST_RESET_MS) counts whatever depth was seen,
 * as before the standards: its bottom may have been in the gap. It stays flagged `lost`. One lost
 * for longer is dropped, neither counted nor missed.
 */
export function createTracker({ drill: drillId = 'squat', standard } = {}) {
  const drill = DRILLS[drillId]
  if (!drill) throw new Error('unknown drill: ' + drillId)
  const std = standardFor(drillId, standard)
  const reps = []
  const conf = { left: 0, right: 0 }
  let phase = 'waiting'
  let angle = null           // smoothed angle
  let lastSeenT = null
  let topRef = 0             // the standing angle, the highest while standing
  let topT = 0               // the last moment still at the top, where a descent starts
  let rep = null             // the rep under way
  let closing = null         // a finished rep whose way up is still being timed

  const closeUp = at => { if (closing) { closing.upSec = round1(Math.max(0, at - closing.bottomT) / 1000); closing = null } }
  const reachedNow = () => !!rep && rep.rawMin < drill.minRep && drill.meets(drill.depth(rep.drop), std)

  function track(joints, side, aspect, raw, t) {
    if (raw < rep.rawMin) rep.rawMin = raw
    const d = drill.reach(joints, side, aspect)
    if (d != null && (rep.drop == null || d > rep.drop)) rep.drop = d
    const l = drill.lean ? drill.lean(joints, side, aspect) : null
    if (l != null && (rep.lean == null || l > rep.lean)) rep.lean = l
    if (angle < rep.min) { rep.min = angle; rep.bottomT = t }
  }

  // Closes the rep: counted, or kept as a no-rep. Returns the record.
  function finish(t) {
    const depth = drill.depth(rep.drop)
    const counted = rep.lost || drill.meets(depth, std)
    const done = {
      depth,
      minKnee: Math.round(rep.rawMin),
      downSec: round1(Math.max(0, rep.bottomT - rep.startT) / 1000),
      upSec: round1(Math.max(0, t - rep.bottomT) / 1000),
      lean: rep.lean == null ? null : Math.round(rep.lean),
      lost: rep.lost,
      counted,
      reason: counted ? null : 'shallow',
      bottomT: rep.bottomT,
      ref: rep.ref,
    }
    reps.push(done)
    closing = done
    return done
  }

  const countedN = () => reps.filter(r => r.counted).length

  function push(frame) {
    const t = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const aspect = frame && frame.aspect > 0 ? frame.aspect : 1
    for (const s of ['left', 'right']) conf[s] += SIDE_SMOOTH * (chainConf(joints, s) - conf[s])
    const side = conf.left >= conf.right ? 'left' : 'right'
    const raw = drill.angle(joints, side, aspect)
    let justCounted = false, justMissed = false, reason = null
    const out = inFrame => ({ reps: countedN(), phase, inFrame, justCounted, justMissed, reason, reached: reachedNow() })

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
      if (angle >= drill.stand) { phase = 'standing'; topRef = angle; topT = t }
      return out(true)
    }
    if (phase === 'standing') {
      if (angle > topRef) topRef = angle
      if (angle >= topRef - TOP_BAND) topT = t
      if (closing && angle >= closing.ref - TOP_BAND) closeUp(t)
      if (angle < drill.descent) {
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
    if (phase === 'ascending' && angle >= drill.stand) {
      if (rep.rawMin < drill.minRep) {
        const done = finish(t)
        if (done.counted) justCounted = true
        else { justMissed = true; reason = done.reason }
      }
      rep = null
      phase = 'standing'
      topRef = angle
      topT = t
    }
    return out(true)
  }

  function result() {
    const list = reps.map(({ bottomT, ref, ...r }) => r)
    const counted = list.filter(r => r.counted)
    const missed = list.length - counted.length
    const cueId = pickCue(counted, missed)
    return { reps: list, summary: summarise(counted, missed), cue: drill.cues[cueId](missed, std), cueId, drill: drill.id, standard: std }
  }

  return { push, result }
}

/** The squat tracker: createTracker for the squat drill ({ standard }). */
export const createSquatTracker = (opts = {}) => createTracker({ ...opts, drill: 'squat' })
