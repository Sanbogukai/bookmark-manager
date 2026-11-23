// The bar across the top: search, the read-state switch and the Add button.
import { useEffect, useState } from 'react'
import { type Filters, type Status, STATUSES } from '../filters.ts'

// How long typing must pause before the search runs, in milliseconds.
const SEARCH_DELAY_MS = 300
// The server's limit on search text.
const SEARCH_MAX = 200

// The switch's label for each status.
const STATUS_LABELS: Record<Status, string> = { all: 'All', unread: 'Unread', read: 'Read' }

interface Props {
  filters: Filters
  onChange: (next: Filters, replace?: boolean) => void
  onAdd: () => void
}

export function TopBar({ filters, onChange, onAdd }: Props) {
  // What is in the search box; it reaches the filters after a pause in typing.
  const [text, setText] = useState(filters.q)
  // The search the box last followed, to notice a change made from outside.
  const [followed, setFollowed] = useState(filters.q)

  // When the search changes from outside (Back, Clear filters), the box follows, set during
  // render as React recommends for state derived from props. A box that only differs by spaces
  // at the ends is left alone, so a pause after a space keeps the space.
  if (followed !== filters.q) {
    setFollowed(filters.q)
    if (text.trim() !== filters.q) setText(filters.q)
  }

  // Runs the search once typing pauses. Replacing the history entry keeps Back useful.
  useEffect(() => {
    const q = text.trim()
    if (q === filters.q) return
    const timer = setTimeout(() => onChange({ ...filters, q }, true), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text, filters, onChange])

  return (
    <header className="topbar">
      <h1 className="brand">Reading List</h1>
      <input
        type="search"
        className="search"
        placeholder="Search titles and links"
        aria-label="Search"
        maxLength={SEARCH_MAX}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="switch" role="group" aria-label="Show">
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={filters.status === status}
            onClick={() => onChange({ ...filters, status })}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>
      <button type="button" className="primary" onClick={onAdd}>Add</button>
    </header>
  )
}
