// @vitest-environment happy-dom
// The Form check result: what was measured, rep by rep, one summary line and the one cue, never a
// verdict; "Use N reps" only where there is a set to put them in.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FormCheckResult, summaryLine } from './FormCheckSheet.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const rep = (depth, extra = {}) => ({ depth, minKnee: 60, downSec: 2.1, upSec: 1, lean: 35, lost: false, ...extra })
const RESULT = {
  reps: [rep('below', { minKnee: 52 }), rep('parallel'), rep('above', { minKnee: 98, lost: true })],
  summary: { count: 3, depthBelow: 1, depthParallel: 1, depthAbove: 1, avgDown: 2.1, avgUp: 1, maxLean: 41, consistency: 46 },
  cue: 'The last reps were shallower than the first ones.', cueId: 'fade',
}

let root, host, close
const render = props => act(() => root.render(<FormCheckResult close={close} title="Barbell squat" {...props} />))
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

beforeEach(() => {
  close = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('FormCheckResult', () => {
  it('lists every rep with its depth, knee angle, tempo and a lost-pose note', () => {
    render({ result: RESULT })
    expect(host.querySelector('h3').textContent).toBe('3 reps')
    const rows = [...host.querySelectorAll('[data-fc-rep]')].map(r => r.textContent)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('Rep 1')
    expect(rows[0]).toContain('Below parallel')
    expect(rows[0]).toContain('52° at the knee')
    expect(rows[0]).toContain('Down 2.1 s · up 1 s')
    expect(rows[0]).not.toContain('Camera lost you')
    expect(rows[2]).toContain('Above parallel')
    expect(rows[2]).toContain('Camera lost you')
  })

  it('ends with the summary line and the one cue', () => {
    render({ result: RESULT })
    expect(host.querySelector('[data-fc-summary]').textContent).toBe(summaryLine(RESULT.summary))
    expect(summaryLine(RESULT.summary)).toBe('1 below parallel, 1 at parallel, 1 above parallel. Down 2.1 s and up 1 s on average. Torso lean up to 41°. Bottom knee angle varied by 46°.')
    expect(host.querySelector('[data-fc-cue]').textContent).toBe(RESULT.cue)
  })

  it('offers "Use N reps" only with somewhere to put them', () => {
    const onUse = vi.fn()
    render({ result: RESULT, onUse })
    act(() => button('Use 3 reps').click())
    expect(onUse).toHaveBeenCalledWith(3)
    expect(close).toHaveBeenCalled()
    render({ result: RESULT, onUse: null })
    expect(button('Use 3 reps')).toBeUndefined()
  })

  it('says so when no rep was counted, with no rows and no button', () => {
    render({ result: { reps: [], summary: { count: 0 }, cue: 'No reps were counted.', cueId: 'none' }, onUse: vi.fn() })
    expect(host.querySelector('h3').textContent).toBe('No reps counted')
    expect(host.querySelectorAll('[data-fc-rep]')).toHaveLength(0)
    expect(host.querySelector('[data-fc-summary]')).toBeNull()
    expect(host.querySelector('[data-fc-cue]').textContent).toBe('No reps were counted.')
    expect([...host.querySelectorAll('button')].map(b => b.textContent.trim())).toEqual(['Close'])
  })
})
