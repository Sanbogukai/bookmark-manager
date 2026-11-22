// The row of tag chips with counts. Selecting several narrows to bookmarks carrying all of them.
import type { TagCount } from '../../../shared/types.ts'

interface Props {
  tags: TagCount[]
  selected: string[]
  onToggle: (tag: string) => void
  onClear: () => void
}

export function TagRow({ tags, selected, onToggle, onClear }: Props) {
  // A selected tag that no longer exists (its last bookmark was deleted) still shows, with 0,
  // so it can be turned off.
  const missing = selected.filter((name) => !tags.some((tag) => tag.name === name)).map((name) => ({ name, count: 0 }))
  const shown = [...missing, ...tags]
  if (shown.length === 0) return null

  return (
    <nav className="tag-row" aria-label="Tags">
      {shown.map((tag) => (
        <button
          key={tag.name}
          type="button"
          className="chip"
          aria-pressed={selected.includes(tag.name)}
          onClick={() => onToggle(tag.name)}
        >
          {tag.name} <span className="count">{tag.count}</span>
        </button>
      ))}
      {selected.length > 0 && (
        <button type="button" className="link" onClick={onClear}>Clear</button>
      )}
    </nav>
  )
}
