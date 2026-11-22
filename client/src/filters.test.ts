// The filters' round trip through the address bar, and the API query built from them.
import { describe, expect, it } from 'vitest'
import { filtersToSearch, hasFilters, NO_FILTERS, parseFilters, toggleTag, toListQuery } from './filters.ts'

describe('filters in the address bar', () => {
  it('reads tags, status and search', () => {
    expect(parseFilters('?tag=react&tag=testing&status=unread&q=%20hooks%20')).toEqual({
      tags: ['react', 'testing'],
      status: 'unread',
      q: 'hooks',
    })
  })

  it('falls back to no filters for an empty or odd query', () => {
    expect(parseFilters('')).toEqual(NO_FILTERS)
    expect(parseFilters('?status=later&tag=&tag=a&tag=a')).toEqual({ tags: ['a'], status: 'all', q: '' })
  })

  it('writes nothing for no filters, so the plain address stays plain', () => {
    expect(filtersToSearch(NO_FILTERS)).toBe('')
  })

  it('survives a round trip', () => {
    const filters = { tags: ['web-dev', 'css'], status: 'read' as const, q: 'grid & flex' }
    expect(parseFilters(filtersToSearch(filters))).toEqual(filters)
  })
})

describe('API query', () => {
  it('adds the cursor only when there is one', () => {
    const filters = { tags: ['a'], status: 'all' as const, q: '' }
    expect(toListQuery(filters, null)).toBe('tag=a')
    expect(toListQuery(filters, 'abc')).toBe('tag=a&cursor=abc')
  })
})

describe('helpers', () => {
  it('knows when a filter is on', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false)
    expect(hasFilters({ ...NO_FILTERS, q: 'x' })).toBe(true)
  })

  it('toggles a tag in and out', () => {
    expect(toggleTag(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleTag(['a', 'b'], 'a')).toEqual(['b'])
  })
})
