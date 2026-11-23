// The bar across the top: search, the read-state switch and the Add button.

// React's effect and state hooks.
import { useEffect, useState } from 'react'
// The filter shape, the status type, and the three statuses in order.
import { type Filters, type Status, STATUSES } from '../filters.ts'

// How long typing must pause before the search runs, in milliseconds.
const SEARCH_DELAY_MS = 300
// The server's limit on search text.
const SEARCH_MAX = 200

// The switch's label for each status.
const STATUS_LABELS: Record<Status, string> = { all: 'All', unread: 'Unread', read: 'Read' }

// What App hands in.
interface Props {
  // The current filters, from the address bar.
  filters: Filters
  // Sets new filters; `replace` swaps the history entry instead of adding one.
  onChange: (next: Filters, replace?: boolean) => void
  // Opens the add dialog.
  onAdd: () => void
}

// The bar itself.
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
    // Spaces at the ends do not change the search.
    const q = text.trim()
    // Already searching for this: nothing to do.
    if (q === filters.q) return
    // Waits for the pause; a new keystroke clears this timer and starts another.
    const timer = setTimeout(() => onChange({ ...filters, q }, true), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text, filters, onChange])

  return (
    <header className="topbar">
      {/* The app's name. */}
      <h1 className="brand">Reading List</h1>
      <input
        // type="search" gives a clear button and the right keyboard on phones.
        type="search"
        className="search"
        placeholder="Search titles and links"
        // The placeholder vanishes once typing starts, so the label names the box.
        aria-label="Search"
        maxLength={SEARCH_MAX}
        value={text}
        // Only the box changes here; the effect above sends the search.
        onChange={(event) => setText(event.target.value)}
      />
      {/* All, Unread, Read: a group of toggle buttons. */}
      <div className="switch" role="group" aria-label="Show">
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            // The current status shows as pressed.
            aria-pressed={filters.status === status}
            // Switching status is a new history entry, so Back returns to the last one.
            onClick={() => onChange({ ...filters, status })}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>
      {/* Opens the add dialog. */}
      <button type="button" className="primary" onClick={onAdd}>Add</button>
    </header>
  )
}
