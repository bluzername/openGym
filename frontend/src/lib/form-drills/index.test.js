// The drill registry: every drill keeps the contract (README.md), declares strings every locale
// has, answers an empty camera without throwing, and drillFor() finds the drill for an exercise.
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DRILLS, checkDrill, drillById, drillFor, drillStrings, standardFor } from './index.js'
import { EXIDX } from '../exercises.js'

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'locales')
const packs = await Promise.all(readdirSync(localesDir).filter(f => f.endsWith('.js')).map(async f => [f, (await import(pathToFileURL(join(localesDir, f)).href)).default]))

describe.each(DRILLS.map(d => [d.id, d]))('drill %s', (id, drill) => {
  it('keeps the contract', () => {
    expect(checkDrill(drill)).toEqual([])
    expect(drillById(id)).toBe(drill)
  })

  it('has its declared strings in every locale', () => {
    for (const [file, pack] of packs) {
      const missing = drillStrings(drill).filter(s => !(s in pack))
      expect({ file, missing }).toEqual({ file, missing: [] })
    }
  })

  it('answers frames with nobody in them, and a result with nothing in it', () => {
    const tr = drill.create({ standard: drill.defaultStandard })
    const out = tr.push({ t: 0, aspect: 0.75, joints: {} })
    expect(out).toMatchObject({ count: 0, inFrame: false, justCounted: false, justMissed: false, reached: false, highlight: [] })
    expect(typeof out.hint).toBe('string')
    expect(out.hint).not.toBe('')
    const res = tr.result()
    expect(res).toMatchObject({ count: 0, missed: 0, reps: [], details: [] })
    expect(res.tiles.length).toBeLessThanOrEqual(3)
    expect(typeof res.cue).toBe('string')
    expect(typeof res.cueId).toBe('string')
  })

  it('says no to nothing and to exercises that are not objects', () => {
    expect(drill.matches(null)).toBe(false)
    expect(drill.matches(undefined)).toBe(false)
    expect(drill.matches('3593')).toBe(false)
  })
})

describe('the registry', () => {
  it('has unique ids', () => {
    expect(new Set(DRILLS.map(d => d.id)).size).toBe(DRILLS.length)
  })

  it('finds the drill for an exercise, none for one no drill judges', () => {
    expect(drillFor(EXIDX['3593'])).toBe(drillById('squat'))
    expect(drillFor(EXIDX['0289'])).toBe(null)
    expect(drillFor(null)).toBe(null)
    expect(drillById('bench')).toBe(null)
  })

  it('keeps a standard that is the drill’s and falls back to its default otherwise', () => {
    expect(standardFor('squat', 'below')).toBe('below')
    expect(standardFor(drillById('squat'), 'knee-deep')).toBe('parallel')
    expect(standardFor('squat')).toBe('parallel')
    expect(standardFor('bench', 'below')).toBe(null)
  })

  it('names what is wrong with a definition', () => {
    expect(checkDrill(null)).toEqual(['not an object'])
    const bad = checkDrill({ id: 'Bad Id', kind: 'sets', views: ['top'], standards: [{ id: 'a', label: 'A' }], defaultStandard: 'b', misses: { x: {} } })
    expect(bad).toEqual(expect.arrayContaining([
      'id: lower-case letters, digits and dashes', 'kind: reps or hold', 'views: side, diagonal and/or front, best first',
      'defaultStandard: one of the standards', 'misses: { reason: { line, say, row } }', 'create: a function',
    ]))
  })
})
