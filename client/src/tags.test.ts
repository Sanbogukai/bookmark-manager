// The tag input's parsing and suggestions.
import { describe, expect, it } from 'vitest'
import { addTags, normalizeTag, splitTyped, suggestTags, TAG_LENGTH_MAX, TAGS_MAX } from './tags.ts'

// One character longer than a tag may be.
const TOO_LONG = 'x'.repeat(TAG_LENGTH_MAX + 1)
// Usage counts for the suggestion tests, named so their order is plain.
const FEW = 2
const SOME = 5
const MANY = 9

describe('normalizeTag', () => {
  it('lower-cases, trims and turns inner spaces into dashes', () => {
    expect(normalizeTag('  Web Dev ')).toBe('web-dev')
  })

  it('refuses what the server would refuse', () => {
    expect(normalizeTag('c++')).toBeNull()
    expect(normalizeTag('   ')).toBeNull()
    expect(normalizeTag(TOO_LONG)).toBeNull()
  })
})

describe('splitTyped', () => {
  it('ends a tag at each comma and keeps the rest in the box', () => {
    expect(splitTyped('react, testing, vi')).toEqual({ names: ['react', ' testing'], rest: ' vi' })
    expect(splitTyped('react')).toEqual({ names: [], rest: 'react' })
  })
})

describe('addTags', () => {
  it('adds valid names once and drops bad ones', () => {
    expect(addTags(['react'], ['React', 'c++', 'css'])).toEqual(['react', 'css'])
  })

  it('stops at the limit', () => {
    const many = Array.from({ length: TAGS_MAX + 1 }, (_, index) => `t${index}`)
    expect(addTags([], many)).toHaveLength(TAGS_MAX)
  })
})

describe('suggestTags', () => {
  const known = [
    { name: 'react', count: FEW },
    { name: 'redux', count: SOME },
    { name: 'css', count: MANY },
  ]

  it('offers unchosen tags with the prefix, the most used first', () => {
    expect(suggestTags('re', [], known)).toEqual(['redux', 'react'])
    expect(suggestTags('re', ['redux'], known)).toEqual(['react'])
  })

  it('offers everything unchosen for an empty box', () => {
    expect(suggestTags('', [], known)).toEqual(['css', 'redux', 'react'])
  })
})
