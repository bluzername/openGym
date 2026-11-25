import { describe, expect, it } from 'vitest'
import { createSquatTracker, createTracker, framing, kneeAngle, pickSide, isSquatPattern, standardFor, depthShare, CUE, DRILLS, FAST_DOWN_SEC, PARALLEL_BAND } from './form-check.js'
import { EXIDX } from './exercises.js'

// A lifter filmed side-on, drawn from one number: the knee angle (180 is straight). The shin tips
// forward a quarter of the bend and the torso leans with it, so the thigh is level at about 60°.
const FPS = 15
const SHIN = 0.2, THIGH = 0.2, TORSO = 0.28
const rad = d => d * Math.PI / 180

function pose(theta, { side = 'left', noise = 0, rnd = Math.random } = {}) {
  const a = rad((180 - theta) / 4)
  const ankle = [0.5, 0.85]
  const knee = [ankle[0] + SHIN * Math.sin(a), ankle[1] - SHIN * Math.cos(a)]
  // knee -> ankle turned by theta, towards the back: the hip.
  const ka = Math.atan2(Math.cos(a), -Math.sin(a))
  const h = ka + rad(theta)
  const hip = [knee[0] + THIGH * Math.cos(h), knee[1] + THIGH * Math.sin(h)]
  const lean = rad((180 - theta) * 0.4)
  const shoulder = [hip[0] + TORSO * Math.sin(lean), hip[1] - TORSO * Math.cos(lean)]
  const j = p => [p[0] + (rnd() - 0.5) * 2 * noise, p[1] + (rnd() - 0.5) * 2 * noise]
  const near = { Hip: hip, Knee: knee, Ankle: ankle, Shoulder: shoulder }
  const joints = {}
  for (const [k, p] of Object.entries(near)) {
    const [x, y] = j(p)
    // The far side sits a little behind and is seen badly.
    const [fx, fy] = j([p[0] + 0.01, p[1]])
    if (side === 'left') { joints['left' + k] = [x, y, 0.9]; joints['right' + k] = [fx, fy, 0.3] }
    else { joints['right' + k] = [1 - x, y, 0.9]; joints['left' + k] = [1 - fx, fy, 0.3] }
  }
  return joints
}

// Seeded, so a noisy test fails the same way every time.
function seeded(seed = 1) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

const ease = f => (1 - Math.cos(Math.PI * f)) / 2

// Frames for a set: `reps` = [{ min, down, up }], standing a second between them.
function setFrames(reps, { side = 'left', noise = 0, seed = 7, gap = null, stand = 1, start = 0 } = {}) {
  const rnd = seeded(seed)
  const out = []
  let t = start
  const push = (theta, n) => { for (let i = 0; i < n; i++) { out.push({ t: Math.round(t), aspect: 1, joints: pose(theta, { side, noise, rnd }) }); t += 1000 / FPS } }
  const top = 176
  push(top, Math.round(stand * FPS))
  for (const r of reps) {
    const dn = Math.max(2, Math.round(r.down * FPS)), up = Math.max(2, Math.round(r.up * FPS))
    for (let i = 1; i <= dn; i++) push(top - (top - r.min) * ease(i / dn), 1)
    push(r.min, 2)
    for (let i = 1; i <= up; i++) push(r.min + (top - r.min) * ease(i / up), 1)
    push(top, Math.round(stand * FPS))
  }
  if (gap) {
    const [from, to] = gap
    for (const f of out) if (f.t >= from && f.t < to) f.joints = {}
  }
  return out
}

// `opts`: the tracker's { standard }. Today's tests of depth and the cue read every real descent
// ('any'); the standards have their own block below.
const run = (frames, opts = {}) => {
  const tr = createSquatTracker(opts)
  let counted = 0, missed = 0
  const missedAt = []
  for (const f of frames) {
    const out = tr.push(f)
    if (out.justCounted) counted++
    if (out.justMissed) { missed++; missedAt.push({ t: f.t, reason: out.reason }) }
  }
  return { tr, counted, missed, missedAt, res: tr.result() }
}
const ANY = { standard: 'any' }
const same = (n, r) => Array.from({ length: n }, () => ({ ...r }))

describe('kneeAngle and pickSide', () => {
  it('reads a straight leg as about 180 and the drawn bend back', () => {
    const j = pose(90)
    expect(kneeAngle(j, 'left')).toBeCloseTo(90, 0)
    expect(kneeAngle(pose(176), 'left')).toBeCloseTo(176, 0)
  })

  it('stretches x by the image shape before measuring', () => {
    // A 3:4 upright image: x in it is 0.75 of y, so the same pose squeezed in x is still 90°.
    const j = Object.fromEntries(Object.entries(pose(90)).map(([k, [x, y, c]]) => [k, [x / 0.75, y, c]]))
    expect(kneeAngle(j, 'left', 0.75)).toBeCloseTo(90, 0)
  })

  it('takes the side whose hip, knee and ankle are seen best', () => {
    expect(pickSide(pose(150))).toBe('left')
    expect(pickSide(pose(150, { side: 'right' }))).toBe('right')
    expect(pickSide({})).toBe(null)
  })
})

describe('createSquatTracker', () => {
  it('counts five clean squats, live and in the result', () => {
    const { counted, res } = run(setFrames(same(5, { min: 50, down: 2, up: 1.2 })))
    expect(counted).toBe(5)
    expect(res.reps).toHaveLength(5)
    expect(res.summary.count).toBe(5)
  })

  it('counts through noise', () => {
    const { res } = run(setFrames(same(6, { min: 55, down: 1.8, up: 1 }), { noise: 0.004 }))
    expect(res.summary.count).toBe(6)
  })

  it('does not count a wobble at the top', () => {
    const frames = setFrames([{ min: 150, down: 0.5, up: 0.5 }, { min: 50, down: 2, up: 1 }, { min: 145, down: 0.4, up: 0.4 }], { noise: 0.003 })
    expect(run(frames).res.summary.count).toBe(1)
  })

  it('does not count anything before the lifter has stood up once', () => {
    // Starts crouched (setting up under the bar), then stands and does two.
    const tr = createSquatTracker()
    for (let i = 0; i < 20; i++) tr.push({ t: i * 66, aspect: 1, joints: pose(70) })
    const rest = setFrames(same(2, { min: 50, down: 2, up: 1 }), { start: 20 * 66 })
    for (const f of rest) tr.push(f)
    expect(tr.result().summary.count).toBe(2)
  })

  it('reads the right side the same as the left', () => {
    const l = run(setFrames(same(3, { min: 50, down: 2, up: 1 }))).res
    const r = run(setFrames(same(3, { min: 50, down: 2, up: 1 }), { side: 'right' })).res
    expect(r.summary.count).toBe(3)
    expect(r.reps.map(x => x.depth)).toEqual(l.reps.map(x => x.depth))
    expect(r.reps[0].minKnee).toBeCloseTo(l.reps[0].minKnee, 0)
  })

  it('names the depth: below, parallel and above', () => {
    const { res } = run(setFrames([{ min: 40, down: 2, up: 1 }, { min: 60, down: 2, up: 1 }, { min: 95, down: 2, up: 1 }]), ANY)
    expect(res.reps.map(r => r.depth)).toEqual(['below', 'parallel', 'above'])
    expect(res.reps[0].minKnee).toBeLessThan(res.reps[2].minKnee)
    expect(res.summary).toMatchObject({ depthBelow: 1, depthParallel: 1, depthAbove: 1 })
  })

  it('times the way down and up to within a few tenths', () => {
    const { res } = run(setFrames(same(3, { min: 50, down: 2.5, up: 1.2 }), { noise: 0.002 }))
    for (const r of res.reps) {
      expect(r.downSec).toBeGreaterThan(1.9)
      expect(r.downSec).toBeLessThan(2.9)
      expect(r.upSec).toBeGreaterThan(0.8)
      expect(r.upSec).toBeLessThan(1.6)
    }
    expect(res.summary.avgDown).toBeGreaterThan(res.summary.avgUp)
  })

  it('measures the torso lean at its most', () => {
    // The drawn lean is 0.4 of the bend: 50° at the bottom of a 55° squat.
    const { res } = run(setFrames(same(2, { min: 55, down: 2, up: 1 })))
    expect(res.reps[0].lean).toBeGreaterThan(44)
    expect(res.reps[0].lean).toBeLessThan(56)
    expect(res.summary.maxLean).toBe(Math.max(...res.reps.map(r => r.lean)))
  })

  it('marks a rep where the pose was lost, and still counts it', () => {
    // The second rep's descent runs from about 5.1 s to 7.1 s: drop half a second of it.
    const { res } = run(setFrames(same(3, { min: 50, down: 2, up: 1 }), { gap: [5900, 6400] }))
    expect(res.summary.count).toBe(3)
    expect(res.reps.map(r => r.lost)).toEqual([false, true, false])
  })

  it('drops a rep the camera lost for good', () => {
    const frames = setFrames(same(2, { min: 50, down: 2, up: 1 }), { gap: [2000, 5000] })
    const { res } = run(frames)
    expect(res.summary.count).toBe(1)
  })

  it('says whether the lifter is in frame', () => {
    const tr = createSquatTracker()
    expect(tr.push({ t: 0, joints: pose(176) }).inFrame).toBe(true)
    expect(tr.push({ t: 66, joints: {} }).inFrame).toBe(false)
  })

  it('keeps its consistency as the spread of the bottom angle', () => {
    const { res } = run(setFrames([{ min: 50, down: 2, up: 1 }, { min: 60, down: 2, up: 1 }, { min: 55, down: 2, up: 1 }]))
    expect(res.summary.consistency).toBeGreaterThan(7)
    expect(res.summary.consistency).toBeLessThan(13)
    expect(run(setFrames([{ min: 50, down: 2, up: 1 }])).res.summary.consistency).toBe(null)
  })
})

describe('the cue', () => {
  it('says go deeper when most reps stop above parallel', () => {
    const { res } = run(setFrames(same(5, { min: 100, down: 2, up: 1 })), ANY)
    expect(res.summary.depthAbove).toBe(5)
    expect(res.cueId).toBe('deeper')
    expect(res.cue).toBe(CUE.deeper())
  })

  it('says slow the way down when the descent is quicker than a second', () => {
    const { res } = run(setFrames(same(4, { min: 50, down: 0.6, up: 0.8 })))
    expect(res.summary.avgDown).toBeLessThan(FAST_DOWN_SEC)
    expect(res.cueId).toBe('slower')
  })

  it('says the last reps were shallower when depth falls off', () => {
    const { res } = run(setFrames([50, 50, 52, 55, 70, 78].map(min => ({ min, down: 2, up: 1 }))), ANY)
    expect(res.cueId).toBe('fade')
  })

  it('asks for a better view when most reps lost the pose', () => {
    // One of three lost is not most.
    const { res } = run(setFrames(same(3, { min: 50, down: 2, up: 1 }), { gap: [1700, 2100] }))
    expect(res.cueId).not.toBe('framing')
    const both = setFrames(same(2, { min: 50, down: 2, up: 1 }))
    const lost = both.map(f => ((f.t > 1700 && f.t < 2000) || (f.t > 5900 && f.t < 6200) ? { ...f, joints: {} } : f))
    expect(run(lost).res.cueId).toBe('framing')
  })

  it('stays neutral when nothing stands out', () => {
    const { res } = run(setFrames(same(5, { min: 50, down: 2, up: 1 }), { noise: 0.002 }))
    expect(res.cueId).toBe('steady')
    expect(typeof res.cue).toBe('string')
  })

  it('has a line for no reps at all', () => {
    const { res } = run(setFrames([]))
    expect(res.summary.count).toBe(0)
    expect(res.cueId).toBe('none')
  })
})

// The knee angle at which the drawn hip sits `d` thigh lengths below the knee (bisection: the
// hip drops as the knee bends).
function thetaForDrop(d) {
  const dropAt = th => { const j = pose(th); return (j.leftHip[1] - j.leftKnee[1]) / Math.hypot(j.leftHip[0] - j.leftKnee[0], j.leftHip[1] - j.leftKnee[1]) }
  let lo = 30, hi = 120
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (dropAt(m) > d) lo = m; else hi = m }
  return (lo + hi) / 2
}

describe('drills and standards', () => {
  // Full: hip well below the knee. Parallel: hip at knee height. Shallow: a real descent above it.
  const FULL = { min: 45, down: 2, up: 1 }, PAR = { min: 60, down: 2, up: 1 }, SHALLOW = { min: 95, down: 2, up: 1 }
  const mixed = () => setFrames([FULL, SHALLOW, PAR, FULL, SHALLOW])

  it('has the squat drill with its standards, parallel by default', () => {
    expect(DRILLS.squat).toMatchObject({ id: 'squat', standards: ['parallel', 'below', 'any'], defaultStandard: 'parallel' })
    expect(standardFor('squat', 'below')).toBe('below')
    expect(standardFor('squat', 'knee-deep')).toBe('parallel')
    expect(standardFor('squat')).toBe('parallel')
    expect(standardFor('bench')).toBe(null)
    expect(() => createTracker({ drill: 'bench' })).toThrow()
    expect(createTracker().result()).toMatchObject({ drill: 'squat', standard: 'parallel' })
  })

  it('parallel (the default): counts the full and parallel reps, keeps the shallow ones as no-reps', () => {
    const { counted, missed, missedAt, res } = run(mixed())
    expect(counted).toBe(3)
    expect(missed).toBe(2)
    expect(missedAt.map(m => m.reason)).toEqual(['shallow', 'shallow'])
    expect(res.reps.map(r => r.counted)).toEqual([true, false, true, true, false])
    expect(res.reps.map(r => r.reason)).toEqual([null, 'shallow', null, null, 'shallow'])
    expect(res.summary).toMatchObject({ count: 3, missed: 2, depthAbove: 0 })
    expect(res.standard).toBe('parallel')
  })

  it('below: only the reps with the hip clearly under the knee count', () => {
    const { counted, missed, res } = run(mixed(), { standard: 'below' })
    expect(counted).toBe(2)
    expect(missed).toBe(3)
    expect(res.reps.map(r => r.counted)).toEqual([true, false, false, true, false])
    expect(res.summary).toMatchObject({ count: 2, missed: 3, depthBelow: 2, depthParallel: 0 })
  })

  it('any: every real descent counts, as before the standards; a wobble still does not', () => {
    const { counted, missed, res } = run(setFrames([FULL, SHALLOW, { min: 150, down: 0.5, up: 0.5 }, PAR]), ANY)
    expect(counted).toBe(3)
    expect(missed).toBe(0)
    expect(res.reps).toHaveLength(3)
    expect(res.reps.every(r => r.counted)).toBe(true)
  })

  it('says justMissed on the frame the no-rep ends, the same frame justCounted would be', () => {
    const frames = setFrames([SHALLOW])
    const asParallel = run(frames)
    const asAny = run(frames, ANY)
    expect(asParallel.missedAt).toHaveLength(1)
    const tr = createSquatTracker(ANY)
    const countedAt = frames.find(f => tr.push(f).justCounted).t
    expect(asParallel.missedAt[0].t).toBe(countedAt)
    expect(asAny.counted).toBe(1)
    // The count does not move on a no-rep.
    const live = createSquatTracker()
    const outs = frames.map(f => live.push(f))
    expect(outs.every(o => o.reps === 0)).toBe(true)
    expect(outs.filter(o => o.justMissed)).toHaveLength(1)
    expect(outs.filter(o => o.justCounted)).toHaveLength(0)
  })

  it('takes the parallel band at its edge: just inside counts, just outside does not', () => {
    const edge = thetaForDrop(-PARALLEL_BAND)
    const inside = run(setFrames([{ min: edge - 1, down: 2, up: 1 }]))
    const outside = run(setFrames([{ min: edge + 1, down: 2, up: 1 }]))
    expect(inside.res.reps[0]).toMatchObject({ depth: 'parallel', counted: true })
    expect(outside.res.reps[0]).toMatchObject({ depth: 'above', counted: false, reason: 'shallow' })
    // And the edge of "below": the same band on the other side of the knee.
    const low = thetaForDrop(PARALLEL_BAND)
    expect(run(setFrames([{ min: low - 1, down: 2, up: 1 }]), { standard: 'below' }).counted).toBe(1)
    expect(run(setFrames([{ min: low + 1, down: 2, up: 1 }]), { standard: 'below' }).missed).toBe(1)
  })

  it('says mid-rep once the standard is reached, and not before', () => {
    const tr = createSquatTracker()
    const outs = setFrames([PAR]).map(f => tr.push(f))
    const first = outs.findIndex(o => o.reached)
    expect(first).toBeGreaterThan(0)
    expect(outs[first].phase).toBe('descending')
    expect(outs.at(-1).reached).toBe(false)
    const shallow = createSquatTracker()
    expect(setFrames([SHALLOW]).map(f => shallow.push(f)).some(o => o.reached)).toBe(false)
  })

  it('times and measures the set over the counted reps only', () => {
    const { res } = run(setFrames([{ min: 45, down: 2, up: 1 }, { min: 95, down: 0.6, up: 0.6 }, { min: 45, down: 2, up: 1 }]))
    expect(res.summary.count).toBe(2)
    expect(res.summary.avgDown).toBeGreaterThan(1.8)
    expect(res.summary.consistency).toBeLessThan(5)
  })

  it('counts a rep the camera lost for a moment whatever depth was seen, as before', () => {
    // The shallow rep is under way from about 5.9 s (knee past 150°) to 7.1 s: drop half a second.
    const { res } = run(setFrames([FULL, SHALLOW, FULL], { gap: [6300, 6800] }))
    expect(res.reps.map(r => [r.lost, r.counted])).toEqual([[false, true], [true, true], [false, true]])
  })

  it('reads how many of every rep reached the depth, no-reps included', () => {
    const { res } = run(mixed())
    expect(depthShare(res.reps, 'parallel')).toEqual({ hit: 3, of: 5, depth: 'parallel' })
    expect(depthShare(res.reps, 'any')).toEqual({ hit: 3, of: 5, depth: 'parallel' })
    expect(depthShare(res.reps, 'below')).toEqual({ hit: 2, of: 5, depth: 'below' })
    expect(depthShare(null, 'below')).toEqual({ hit: 0, of: 0, depth: 'below' })
  })

  it('puts the no-reps first in the cue, with how many and why', () => {
    const { res } = run(mixed())
    expect(res.cueId).toBe('missed')
    expect(res.cue).toBe('Reps that did not count: 2. The hip stayed above the knee.')
    const below = run(mixed(), { standard: 'below' }).res
    expect(below.cue).toBe('Reps that did not count: 3. The hip did not get below the knee.')
    // Every rep missed: still the no-rep cue, not "no reps were counted".
    const none = run(setFrames(same(3, SHALLOW))).res
    expect(none.summary).toMatchObject({ count: 0, missed: 3, avgDown: null })
    expect(none.cueId).toBe('missed')
  })
})

describe('framing', () => {
  it('is null when the pose can be judged', () => {
    expect(framing({ joints: pose(176) })).toBe(null)
  })

  it('says nobody is there', () => {
    expect(framing({ joints: {} })).toBe('none')
    expect(framing(null)).toBe('none')
  })

  it('says part of the body is out of frame', () => {
    const j = pose(176)
    delete j.leftAnkle; delete j.rightAnkle
    expect(framing({ joints: j })).toBe('partial')
  })

  it('says the lifter faces the camera instead of standing side-on', () => {
    // Front-on: the hips are a hip-width apart, both seen well.
    const j = pose(176)
    for (const k of ['Hip', 'Knee', 'Ankle', 'Shoulder']) {
      j['left' + k] = [j['left' + k][0] + 0.09, j['left' + k][1], 0.9]
      j['right' + k] = [j['left' + k][0] - 0.18, j['left' + k][1], 0.9]
    }
    expect(framing({ joints: j })).toBe('facing')
  })

  it('says the lifter is too far away', () => {
    const j = Object.fromEntries(Object.entries(pose(176)).map(([k, [x, y, c]]) => [k, [0.5 + (x - 0.5) / 3, 0.5 + (y - 0.5) / 3, c]]))
    expect(framing({ joints: j })).toBe('far')
  })
})

describe('isSquatPattern', () => {
  it('takes the squats of the allow-list', () => {
    expect(isSquatPattern(EXIDX['3593'])).toBe(true)   // barbell squat
    expect(isSquatPattern(EXIDX['2966'])).toBe(true)   // dumbbell front squat
    expect(isSquatPattern(EXIDX['0043'])).toBe(true)   // barbell full squat
  })

  it('leaves the rest of the plan out, even on the allow-list user plan', () => {
    expect(isSquatPattern(EXIDX['9698'])).toBe(false)  // dumbbell chest supported row
    expect(isSquatPattern(EXIDX['0289'])).toBe(false)  // dumbbell bench press
  })

  it('takes a two-legged squat by its name, a custom one too', () => {
    expect(isSquatPattern(EXIDX['1760'])).toBe(true)   // dumbbell goblet squat
    expect(isSquatPattern({ id: 'c1', n: 'Safety bar squat', cat: 'strength' })).toBe(true)
  })

  it('leaves out squats a side-on knee angle cannot read: one leg, jumps, holds, combos', () => {
    for (const id of ['2290', '0053', '4362', '1003', '4754', '3747', '1540']) expect(isSquatPattern(EXIDX[id])).toBe(false)
    expect(isSquatPattern(null)).toBe(false)
  })
})
