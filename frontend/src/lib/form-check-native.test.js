// The page's side of Form check against a stand-in FormCheck plugin: it is offered only on the
// iPhone with the plugin saying yes, poses become reps said aloud, the status line is only
// updated when it changes, and the result arrives when the native view closes.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { platform: 'ios', available: true, listeners: {}, calls: [], said: [], startFails: null }
})

const plugin = {
  available: async () => ({ available: h.available }),
  start: async args => { h.calls.push(['start', args]); if (h.startFails) throw h.startFails },
  stop: async () => { h.calls.push(['stop']) },
  setStatus: async args => { h.calls.push(['setStatus', args]) },
  addListener: (name, fn) => { h.listeners[name] = fn; return Promise.resolve({ remove: async () => { delete h.listeners[name] } }) },
}
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => h.platform, isPluginAvailable: () => true },
  registerPlugin: () => plugin,
}))
vi.mock('./speech.js', () => ({ speak: vi.fn(async text => { h.said.push(text); return true }) }))

const { formCheckAvailable, runSquatCheck, framingHint, _resetFormCheck } = await import('./form-check-native.js')

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
function squats(n) {
  const out = []
  let t = 0
  const at = th => { out.push({ t, aspect: 1, joints: joints(th) }); t += 66 }
  for (let i = 0; i < 15; i++) at(176)
  for (let r = 0; r < n; r++) {
    for (let i = 1; i <= 25; i++) at(176 - 126 * i / 25)
    for (let i = 1; i <= 15; i++) at(50 + 126 * i / 15)
    for (let i = 0; i < 10; i++) at(176)
  }
  return out
}
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  _resetFormCheck()
  h.platform = 'ios'; h.available = true; h.listeners = {}; h.calls = []; h.said = []; h.startFails = null
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
    const statuses = h.calls.filter(c => c[0] === 'setStatus')
    expect(statuses.length).toBeLessThan(10)
    expect(statuses.at(-1)[1]).toEqual({ text: '', reps: 3 })
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
    expect(h.calls.find(c => c[0] === 'setStatus')[1]).toEqual({ text: framingHint('none'), reps: 0 })
    expect(framingHint('facing')).toBe('Turn side-on to the camera')
  })

  it('rejects when the camera view cannot open', async () => {
    h.startFails = Object.assign(new Error('Camera access is off'), { code: 'denied' })
    await expect(runSquatCheck({})).rejects.toThrow('Camera access is off')
  })
})
