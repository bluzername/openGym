// @vitest-environment happy-dom
// The Form check sheets. The intro: the camera and the depth a rep counts from, remembered. The
// result: the counted reps big, the no-reps right under them, three tiles, the one cue as a
// callout, and every rep folded away; "Use N reps" only where there is a set to put them in.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FormCheckIntro, FormCheckResult, summaryLine } from './FormCheckSheet.jsx'
import { storedStandard } from '../lib/form-check-standard.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const rep = (depth, extra = {}) => ({ depth, minKnee: 60, downSec: 2.1, upSec: 1, lean: 35, lost: false, counted: true, reason: null, ...extra })
const RESULT = {
  reps: [rep('below', { minKnee: 52 }), rep('parallel'), rep('above', { minKnee: 98, lost: true })],
  summary: { count: 3, missed: 0, depthBelow: 1, depthParallel: 1, depthAbove: 1, avgDown: 2.1, avgUp: 1, maxLean: 41, consistency: 46 },
  cue: 'The last reps were shallower than the first ones.', cueId: 'fade', standard: 'any',
}
const MISSED = {
  reps: [rep('below'), rep('above', { minKnee: 95, counted: false, reason: 'shallow' }), rep('parallel'), rep('below')],
  summary: { count: 3, missed: 1, depthBelow: 2, depthParallel: 1, depthAbove: 0, avgDown: 2, avgUp: 1.2, maxLean: 40, consistency: 8 },
  cue: 'Reps that did not count: 1. The hip stayed above the knee.', cueId: 'missed', standard: 'parallel',
}

let root, host, close
const render = (el) => act(() => root.render(el))
const result = props => render(<FormCheckResult close={close} title="Barbell squat" {...props} />)
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
  it('starts with the camera and the depth picked, Parallel by default, and remembers the depth', () => {
    const onStart = vi.fn()
    render(<FormCheckIntro title="Barbell squat" close={close} onStart={onStart} />)
    expect(host.textContent).toContain('Counts from')
    const depth = host.querySelector('[data-fc-standard]')
    expect([...depth.querySelectorAll('button')].map(b => [b.textContent, b.getAttribute('aria-pressed')]))
      .toEqual([['Parallel', 'true'], ['Below parallel', 'false'], ['Any depth', 'false']])
    act(() => button('Below parallel').click())
    act(() => button('Front camera').click())
    act(() => button('Start').click())
    expect(onStart).toHaveBeenCalledWith('front', 'below')
    expect(storedStandard('squat')).toBe('below')
  })

  it('opens on the depth picked last time', () => {
    render(<FormCheckIntro title="Barbell squat" close={close} onStart={vi.fn()} />)
    act(() => button('Any depth').click())
    act(() => root.unmount())
    root = createRoot(host)
    render(<FormCheckIntro title="Barbell squat" close={close} onStart={vi.fn()} />)
    expect(button('Any depth').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('FormCheckResult', () => {
  it('leads with the counted reps, big, and nothing under them when none were missed', () => {
    result({ result: RESULT })
    expect(host.querySelector('[data-fc-count]').textContent).toBe('3')
    expect(host.querySelector('[data-fc-hero]').textContent).toContain('Counted reps')
    expect(host.querySelector('[data-fc-missed]')).toBeNull()
  })

  it('says how many did not count right under the count', () => {
    result({ result: MISSED })
    expect(host.querySelector('[data-fc-count]').textContent).toBe('3')
    const missed = host.querySelector('[data-fc-missed]')
    expect(missed.textContent).toBe('1 did not count')
    expect(missed.closest('[data-fc-hero]')).toBeTruthy()
  })

  it('shows depth, tempo and consistency as tiles', () => {
    result({ result: MISSED })
    expect(tiles()).toEqual([['depth', '3 of 4'], ['tempo', '2 / 1.2 s'], ['consistency', '8°']])
    expect(host.querySelector('[data-fc-tile="depth"]').textContent).toContain('at parallel or deeper')
    // Under "below", the depth tile counts the reps below parallel.
    result({ result: { ...MISSED, standard: 'below' } })
    expect(tiles()[0]).toEqual(['depth', '2 of 4'])
    expect(host.querySelector('[data-fc-tile="depth"]').textContent).toContain('below parallel')
  })

  it('falls back to the lean tile when one rep cannot show a spread', () => {
    result({ result: { reps: [rep('below')], summary: { count: 1, missed: 0, depthBelow: 1, avgDown: 2, avgUp: 1, maxLean: 38, consistency: null }, cue: 'x', cueId: 'steady' } })
    expect(tiles().map(t => t[0])).toEqual(['depth', 'tempo', 'lean'])
    expect(tiles()[2][1]).toBe('38°')
  })

  it('puts the one cue in a callout card', () => {
    result({ result: MISSED })
    const cue = host.querySelector('[data-fc-cue]')
    expect(cue.classList.contains('fc-callout')).toBe(true)
    expect(cue.querySelector('svg')).toBeTruthy()
    expect(cue.textContent).toBe(MISSED.cue)
  })

  it('folds every rep away until "Every rep" is tapped, a no-rep marked with why', () => {
    result({ result: MISSED })
    const toggle = button('Every rep')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelectorAll('[data-fc-rep]')).toHaveLength(0)
    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const rows = [...host.querySelectorAll('[data-fc-rep]')]
    expect(rows).toHaveLength(4)
    expect(rows[0].textContent).toContain('Rep 1')
    expect(rows[0].textContent).toContain('Below parallel')
    expect(rows[0].textContent).toContain('Down 2.1 s · up 1 s')
    expect(rows[1].classList.contains('missed')).toBe(true)
    expect(rows[1].textContent).toContain('Not counted: too shallow')
    expect(rows[2].textContent).not.toContain('Not counted')
    expect(host.querySelector('[data-fc-summary]').textContent).toBe(summaryLine(MISSED.summary))
  })

  it('still notes a rep where the camera lost the lifter', () => {
    result({ result: RESULT })
    act(() => button('Every rep').click())
    const rows = [...host.querySelectorAll('[data-fc-rep]')].map(r => r.textContent)
    expect(rows[2]).toContain('Camera lost you')
    expect(rows[0]).not.toContain('Camera lost you')
  })

  it('keeps the summary line of the counted reps', () => {
    expect(summaryLine(RESULT.summary)).toBe('1 below parallel, 1 at parallel, 1 above parallel. Down 2.1 s and up 1 s on average. Torso lean up to 41°. Bottom knee angle varied by 46°.')
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
    result({ result: { reps: [], summary: { count: 0, missed: 0 }, cue: 'No reps were counted.', cueId: 'none' }, onUse: vi.fn() })
    expect(host.querySelector('[data-fc-count]').textContent).toBe('0')
    expect(host.querySelectorAll('[data-fc-tile]')).toHaveLength(0)
    expect(button('Every rep')).toBeUndefined()
    expect(host.querySelector('[data-fc-cue]').textContent).toBe('No reps were counted.')
    expect([...host.querySelectorAll('button')].map(b => b.textContent.trim())).toEqual(['Close'])
  })

  it('with every rep missed: no tempo to show, the depth tile and the rows still there', () => {
    const all = { reps: [rep('above', { counted: false, reason: 'shallow' })], summary: { count: 0, missed: 1, avgDown: null, avgUp: null, maxLean: null, consistency: null }, cue: 'c', cueId: 'missed', standard: 'parallel' }
    result({ result: all, onUse: vi.fn() })
    expect(host.querySelector('[data-fc-missed]').textContent).toBe('1 did not count')
    expect(tiles()).toEqual([['depth', '0 of 1']])
    expect(button('Every rep')).toBeTruthy()
    expect(button('Use 0 reps')).toBeUndefined()
  })
})
