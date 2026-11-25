// @vitest-environment happy-dom
// The Form check sheets, drill-agnostic. The intro: the drill's setup, the camera and the
// drill's standards, remembered. The result: the counted reps (or seconds held) big, the no-reps
// under them, the drill's tiles, its one cue as a callout, and every rep's rows folded away;
// "Use N reps" only for a reps drill and only where there is a set to put them in.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FormCheckIntro, FormCheckResult } from './FormCheckSheet.jsx'
import { storedStandard } from '../lib/form-check-standard.js'
import { drillById } from '../lib/form-drills/index.js'
import { squatSet } from '../lib/form-drills/test-kit.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SQUAT = drillById('squat')
const resultOf = (reps, opts = {}, standard) => {
  const tr = SQUAT.create({ standard })
  for (const f of squatSet(reps, opts)) tr.push(f)
  return { ...tr.result(), drill: 'squat', kind: 'reps' }
}
const FULL = { min: 45, down: 2, up: 1 }, PAR = { min: 60, down: 2, up: 1 }, SHALLOW = { min: 95, down: 2, up: 1 }
// Side-on: three counted, one too shallow.
const MISSED = resultOf([FULL, SHALLOW, PAR, FULL])
// A hold drill as a second engineer might add it: only what the sheets read.
const PLANK = { id: 'plank', kind: 'hold', standards: [{ id: 'straight', label: 'Straight' }], defaultStandard: 'straight', setup: 'Side-on, the whole body in the frame.', misses: {} }

let root, host, close
const render = (el) => act(() => root.render(el))
const result = props => render(<FormCheckResult close={close} title="Barbell squat" drill={SQUAT} {...props} />)
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const tiles = () => [...host.querySelectorAll('[data-fc-tile]')].map(t => [t.dataset.fcTile, t.querySelector('.v').textContent])

beforeEach(() => {
  localStorage.clear()
  close = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('FormCheckIntro', () => {
  it('shows the drill setup and its standards, the default first, and remembers the pick', () => {
    const onStart = vi.fn()
    render(<FormCheckIntro title="Barbell squat" drill={SQUAT} close={close} onStart={onStart} />)
    expect(host.querySelector('[data-fc-setup]').textContent).toBe(SQUAT.setup)
    expect(host.textContent).not.toContain('stand side-on')
    const depth = host.querySelector('[data-fc-standard]')
    expect([...depth.querySelectorAll('button')].map(b => [b.textContent, b.getAttribute('aria-pressed')]))
      .toEqual([['Parallel', 'true'], ['Below parallel', 'false'], ['Any depth', 'false']])
    act(() => button('Below parallel').click())
    act(() => button('Front camera').click())
    act(() => button('Start').click())
    expect(onStart).toHaveBeenCalledWith('front', 'below')
    expect(storedStandard('squat')).toBe('below')
  })

  it('opens on the standard picked last time', () => {
    render(<FormCheckIntro title="Barbell squat" drill={SQUAT} close={close} onStart={vi.fn()} />)
    act(() => button('Any depth').click())
    act(() => root.unmount())
    root = createRoot(host)
    render(<FormCheckIntro title="Barbell squat" drill={SQUAT} close={close} onStart={vi.fn()} />)
    expect(button('Any depth').getAttribute('aria-pressed')).toBe('true')
  })

  it('offers no choice for a drill with one standard', () => {
    const onStart = vi.fn()
    render(<FormCheckIntro title="Plank" drill={PLANK} close={close} onStart={onStart} />)
    expect(host.querySelector('[data-fc-standard]')).toBeNull()
    act(() => button('Start').click())
    expect(onStart).toHaveBeenCalledWith('back', 'straight')
  })
})

describe('FormCheckResult', () => {
  it('leads with the counted reps, big, and how many did not count right under them', () => {
    result({ result: MISSED })
    expect(host.querySelector('[data-fc-count]').textContent).toBe('3')
    expect(host.querySelector('[data-fc-hero]').textContent).toContain('Counted reps')
    const missed = host.querySelector('[data-fc-missed]')
    expect(missed.textContent).toBe('1 did not count')
    expect(missed.closest('[data-fc-hero]')).toBeTruthy()
    result({ result: resultOf([FULL, FULL]) })
    expect(host.querySelector('[data-fc-missed]')).toBeNull()
  })

  it('renders the drill tiles as they come, side-on and from the front', () => {
    result({ result: MISSED })
    expect(tiles().map(x => x[0])).toEqual(['depth', 'tempo', 'consistency'])
    expect(tiles()[0][1]).toBe('3 of 4')
    result({ result: resultOf([{ ...FULL, cave: 1 }, FULL], { yaw: 90 }) })
    expect(tiles()).toContainEqual(['knees', '1 of 2'])
  })

  it('puts the one cue in a callout card, a warning for no-reps', () => {
    result({ result: MISSED })
    const cue = host.querySelector('[data-fc-cue]')
    expect(cue.classList.contains('fc-callout')).toBe(true)
    expect(cue.textContent).toBe('Reps that did not count: 1. The hip stayed above the knee.')
  })

  it('folds every rep away until "Every rep" is tapped, each with the drill rows and a no-rep marked', () => {
    result({ result: MISSED })
    const toggle = button('Every rep')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelectorAll('[data-fc-rep]')).toHaveLength(0)
    act(() => toggle.click())
    const rows = [...host.querySelectorAll('[data-fc-rep]')]
    expect(rows).toHaveLength(4)
    expect(rows[0].textContent).toContain('Rep 1')
    expect(rows[0].textContent).toContain('Depth Below parallel')
    expect(rows[0].textContent).toMatch(/Tempo Down \d(\.\d)? s · up \d(\.\d)? s/)
    expect(rows[0].textContent).toContain('Knee angle')
    expect(rows[1].classList.contains('missed')).toBe(true)
    expect(rows[1].textContent).toContain('Not counted: too shallow')
    expect(rows[2].textContent).not.toContain('Not counted')
    expect(host.querySelector('[data-fc-note]').textContent).toBe('Filmed from the side: depth, tempo, knee angle and torso lean.')
  })

  it('still notes a rep where the camera lost the lifter', () => {
    result({ result: resultOf([FULL, FULL, FULL], { gap: [5900, 6400] }) })
    act(() => button('Every rep').click())
    const rows = [...host.querySelectorAll('[data-fc-rep]')].map(r => r.textContent)
    expect(rows[1]).toContain('Camera lost you')
    expect(rows[0]).not.toContain('Camera lost you')
  })

  it('offers "Use N reps" with the counted reps only, and only with somewhere to put them', () => {
    const onUse = vi.fn()
    result({ result: MISSED, onUse })
    expect(button('Use 4 reps')).toBeUndefined()
    act(() => button('Use 3 reps').click())
    expect(onUse).toHaveBeenCalledWith(3)
    expect(close).toHaveBeenCalled()
    result({ result: MISSED, onUse: null })
    expect(button('Use 3 reps')).toBeUndefined()
  })

  it('with nothing at all: a zero, the cue, no tiles, no rows and only Close', () => {
    result({ result: resultOf([]), onUse: vi.fn() })
    expect(host.querySelector('[data-fc-count]').textContent).toBe('0')
    expect(host.querySelectorAll('[data-fc-tile]')).toHaveLength(0)
    expect(button('Every rep')).toBeUndefined()
    expect(host.querySelector('[data-fc-cue]').textContent).toBe('No reps were counted. Get your whole body in the frame and try again.')
    expect([...host.querySelectorAll('button')].map(b => b.textContent.trim())).toEqual(['Close'])
  })

  it('with every rep missed: no tempo to show, the depth tile and the rows still there', () => {
    result({ result: resultOf([SHALLOW]), onUse: vi.fn() })
    expect(host.querySelector('[data-fc-missed]').textContent).toBe('1 did not count')
    expect(tiles()).toEqual([['depth', '0 of 1']])
    expect(button('Every rep')).toBeTruthy()
    expect(button('Use 0 reps')).toBeUndefined()
  })

  it('shows a hold as seconds held, without "Use N reps"', () => {
    const held = { count: 42, missed: 0, reps: [], tiles: [{ id: 'sag', label: 'Hips', value: '2 s', sub: 'sagging' }], cue: 'Held steady.', cueId: 'steady', details: [] }
    result({ result: held, drill: PLANK, onUse: vi.fn() })
    expect(host.querySelector('[data-fc-count]').textContent).toBe('42')
    expect(host.querySelector('[data-fc-hero]').textContent).toContain('Seconds held in position')
    expect(tiles()).toEqual([['sag', '2 s']])
    expect(button('Use 42 reps')).toBeUndefined()
  })
})
