// The row of tag chips with counts. Selecting several narrows to bookmarks carrying all of them.

// A tag name with how many bookmarks carry it.
import type { TagCount } from '../../../shared/types.ts'

// What App hands in.
interface Props {
  // Every tag in this list, with counts, from the server.
  tags: TagCount[]
  // The tags the list is filtered on.
  selected: string[]
  // Turns one tag's filter on or off.
  onToggle: (tag: string) => void
  // Turns every tag filter off.
  onClear: () => void
}

// The row itself; nothing at all when there are no tags.
export function TagRow({ tags, selected, onToggle, onClear }: Props) {
  // A selected tag that no longer exists (its last bookmark was deleted) still shows, with 0,
  // so it can be turned off.
  const missing = selected.filter((name) => !tags.some((tag) => tag.name === name)).map((name) => ({ name, count: 0 }))
  // Those leftovers first, then the real tags.
  const shown = [...missing, ...tags]
  // No tags: no row, rather than an empty strip.
  if (shown.length === 0) return null

  return (
    // A labelled nav, since the chips move around the list.
    <nav className="tag-row" aria-label="Tags">
      {/* One chip per tag; key lets React match chips between renders. */}
      {shown.map((tag) => (
        <button
          key={tag.name}
          type="button"
          className="chip"
          // Pressed while the list is filtered on this tag.
          aria-pressed={selected.includes(tag.name)}
          // Turns this tag's filter on or off.
          onClick={() => onToggle(tag.name)}
        >
          {/* The name, then the count in a smaller style. */}
          {tag.name} <span className="count">{tag.count}</span>
        </button>
      ))}
      {/* Clear shows only while some tag is selected. */}
      {selected.length > 0 && (
        <button type="button" className="link" onClick={onClear}>Clear</button>
      )}
    </nav>
  )
}
