// The page's side of Form check against a stand-in FormCheck plugin: it is offered only on the
// iPhone with the plugin saying yes, poses become reps said aloud, the status line is only
// updated when it changes, and the result arrives when the native view closes.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { platform: 'ios', available: true, listeners: {}, calls: [], said: [], sayOpts: [], startFails: null }
})

const plugin = {
  available: async () => ({ available: h.available }),
  start: async args => { h.calls.push(['start', args]); if (h.startFails) throw h.startFails },
  stop: async () => { h.calls.push(['stop']) },
  setStatus: async args => { h.calls.push(['setStatus', args]) },
  feedback: async args => { h.calls.push(['feedback', args]) },
  addListener: (name, fn) => { h.listeners[name] = fn; return Promise.resolve({ remove: async () => { delete h.listeners[name] } }) },
}
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => h.platform, isPluginAvailable: () => true },
  registerPlugin: () => plugin,
}))
vi.mock('./speech.js', () => ({ speak: vi.fn(async (text, opts) => { h.said.push(text); h.sayOpts.push(opts); return true }) }))

const { formCheckAvailable, runSquatCheck, framingHint, missedHint, MISS_SHOW_MS, _resetFormCheck } = await import('./form-check-native.js')

// A side-on lifter at a knee angle (same drawing as form-check.test.js, simplified).
const rad = d => d * Math.PI / 180
function joints(theta) {
  const a = rad((180 - theta) / 4)
  const ankle = [0.5, 0.85], knee = [0.5 + 0.2 * Math.sin(a), 0.85 - 0.2 * Math.cos(a)]
  const hd = Math.atan2(Math.cos(a), -Math.sin(a)) + rad(theta)
  const hip = [knee[0] + 0.2 * Math.cos(hd), knee[1] + 0.2 * Math.sin(hd)]
  const shoulder = [hip[0], hip[1] - 0.28]
  return { leftHip: [...hip, 0.9], leftKnee: [...knee, 0.9], leftAnkle: [...ankle, 0.9], leftShoulder: [...shoulder, 0.9] }
}
// `mins`: each rep's bottom knee angle, or a count of full (50°) reps. 95° stops above parallel.
function squats(mins, { rest = 10 } = {}) {
  const list = typeof mins === 'number' ? Array(mins).fill(50) : mins
  const out = []
  let t = 0
  const at = th => { out.push({ t, aspect: 1, joints: joints(th) }); t += 66 }
  for (let i = 0; i < 15; i++) at(176)
  for (const min of list) {
    for (let i = 1; i <= 25; i++) at(176 - (176 - min) * i / 25)
    for (let i = 1; i <= 15; i++) at(min + (176 - min) * i / 15)
    for (let i = 0; i < rest; i++) at(176)
  }
  return out
}
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  _resetFormCheck()
  h.platform = 'ios'; h.available = true; h.listeners = {}; h.calls = []; h.said = []; h.sayOpts = []; h.startFails = null
})

describe('formCheckAvailable', () => {
  it('is true on the iPhone when the plugin says it can run', async () => {
    expect(await formCheckAvailable()).toBe(true)
  })
  it('is false when the plugin says no (the simulator has no camera)', async () => {
    h.available = false
    expect(await formCheckAvailable()).toBe(false)
  })
  it('is false on Android', async () => {
    h.platform = 'android'
    expect(await formCheckAvailable()).toBe(false)
  })
})

describe('runSquatCheck', () => {
  it('counts the reps aloud, updates the status line on change only, and resolves on close', async () => {
    const updates = []
    const run = runSquatCheck({ camera: 'front', onUpdate: u => updates.push(u), voice: { rate: 1.2 } })
    await flush(); await flush()
    expect(h.calls[0]).toEqual(['start', { camera: 'front', labels: { done: 'Done', flip: 'Switch camera' } }])
    const frames = squats(3)
    for (const f of frames) h.listeners.pose(f)
    expect(h.said).toEqual(['1', '2', '3'])
    expect(h.sayOpts[0]).toMatchObject({ rate: 1.2, onSilent: true, queue: false })
    const statuses = h.calls.filter(c => c[0] === 'setStatus')
    expect(statuses.length).toBeLessThan(20)
    expect(statuses.at(-1)[1]).toEqual({ text: '', reps: 3, reached: false })
    expect(h.calls.filter(c => c[0] === 'feedback').map(c => c[1].kind)).toEqual(['counted', 'counted', 'counted'])
    expect(updates).toHaveLength(frames.length)
    h.listeners.closed({})
    const res = await run
    expect(res.summary.count).toBe(3)
    await flush()
    expect(h.listeners.pose).toBeUndefined()
  })

  it('says why the pose cannot be judged yet', async () => {
    runSquatCheck({})
    await flush(); await flush()
    h.listeners.pose({ t: 0, joints: {} })
    expect(h.calls.find(c => c[0] === 'setStatus')[1]).toEqual({ text: framingHint('none'), reps: 0, reached: false })
    expect(framingHint('facing')).toBe('Turn side-on to the camera')
  })

  it('says a no-rep at once, queued behind any number, flashes it and shows why for about 2 s', async () => {
    const run = runSquatCheck({ voice: { rate: 1 } })
    await flush(); await flush()
    // Full, shallow, full under the default standard (parallel), standing 2.6 s between.
    const frames = squats([50, 95, 50], { rest: 40 })
    let missedAt = null
    const lineAt = {}
    for (const f of frames) {
      const before = h.calls.length
      h.listeners.pose(f)
      for (const c of h.calls.slice(before)) {
        if (c[0] === 'feedback' && c[1].kind === 'missed') missedAt = f.t
        if (c[0] === 'setStatus') lineAt[f.t] = c[1]
      }
    }
    expect(h.said).toEqual(['1', 'Too shallow', '2'])
    expect(h.sayOpts[1]).toMatchObject({ onSilent: true, queue: true })
    const fb = h.calls.filter(c => c[0] === 'feedback').map(c => c[1])
    expect(fb).toEqual([{ kind: 'counted' }, { kind: 'missed', text: missedHint('shallow') }, { kind: 'counted' }])
    // The reason goes up with the miss, the count stays, and the line clears after MISS_SHOW_MS.
    expect(lineAt[missedAt]).toEqual({ text: missedHint('shallow'), reps: 1, reached: false })
    const cleared = Object.keys(lineAt).map(Number).find(t => t > missedAt && lineAt[t].text !== missedHint('shallow'))
    expect(cleared - missedAt).toBeGreaterThanOrEqual(MISS_SHOW_MS)
    expect(cleared - missedAt).toBeLessThan(MISS_SHOW_MS + 200)
    h.listeners.closed({})
    const res = await run
    expect(res.summary).toMatchObject({ count: 2, missed: 1 })
    expect(res.standard).toBe('parallel')
  })

  it('counts from the standard it is given, and tells the view once it is reached mid-rep', async () => {
    const run = runSquatCheck({ standard: 'any' })
    await flush(); await flush()
    for (const f of squats([95, 50])) h.listeners.pose(f)
    expect(h.said).toEqual(['1', '2'])
    const reached = h.calls.filter(c => c[0] === 'setStatus').map(c => c[1].reached)
    // Off, on during each rep, off again once it is counted.
    expect(reached.filter((v, i) => v !== reached[i - 1])).toEqual([false, true, false, true, false])
    h.listeners.closed({})
    expect((await run).standard).toBe('any')
  })

  it('rejects when the camera view cannot open', async () => {
    h.startFails = Object.assign(new Error('Camera access is off'), { code: 'denied' })
    await expect(runSquatCheck({})).rejects.toThrow('Camera access is off')
  })
})
