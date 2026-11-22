// The list's filters and their two text forms: the page's address bar (so a filtered view
// survives a reload and can be bookmarked) and the API's query string (which adds the cursor).

// Which bookmarks to show by read state.
export type Status = 'all' | 'unread' | 'read'

// Every status, in the order the switch shows them.
export const STATUSES: Status[] = ['all', 'unread', 'read']

// The filters. Several tags mean bookmarks carrying all of them.
export interface Filters {
  tags: string[]
  status: Status
  q: string
}

// No filters at all.
export const NO_FILTERS: Filters = { tags: [], status: 'all', q: '' }

// Whether text names a status; anything else in the address bar falls back to "all".
function isStatus(text: string | null): text is Status {
  return STATUSES.some((status) => status === text)
}

// The filters in an address-bar query such as "?tag=a&tag=b&status=unread&q=react".
export function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search)
  const status = params.get('status')
  return {
    // Each tag once, ignoring empty values.
    tags: [...new Set(params.getAll('tag').filter(Boolean))],
    status: isStatus(status) ? status : 'all',
    q: params.get('q')?.trim() ?? '',
  }
}

// The query parameters for the filters, leaving out anything at its default.
function filterParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams()
  filters.tags.forEach((tag) => params.append('tag', tag))
  if (filters.status !== 'all') params.set('status', filters.status)
  if (filters.q) params.set('q', filters.q)
  return params
}

// The address-bar form: "?…", or "" when nothing is filtered, so the plain address stays plain.
export function filtersToSearch(filters: Filters): string {
  const text = filterParams(filters).toString()
  return text ? `?${text}` : ''
}

// The API's query string: the filters plus the cursor for the next page.
export function toListQuery(filters: Filters, cursor: string | null): string {
  const params = filterParams(filters)
  if (cursor !== null) params.set('cursor', cursor)
  return params.toString()
}

// Whether any filter is on, which picks between the two empty-list messages.
export function hasFilters(filters: Filters): boolean {
  return filters.tags.length > 0 || filters.status !== 'all' || filters.q !== ''
}

// The tag list with `tag` added, or removed if it was already there.
export function toggleTag(tags: string[], tag: string): string[] {
  return tags.includes(tag) ? tags.filter((name) => name !== tag) : [...tags, tag]
}
