// One saved link: icon, title, host, description, tags, date, the Read toggle and a small
// menu with Edit and Delete. Delete asks inside the menu before it goes ahead.
import { useEffect, useRef, useState } from 'react'
import type { Bookmark } from '../../../shared/types.ts'
import { formatDate, hostOf } from '../format.ts'

// Where the menu stands: shut, open, or asking whether to delete.
type MenuState = 'closed' | 'open' | 'confirm'

interface Props {
  bookmark: Bookmark
  selectedTags: string[]
  onToggleRead: () => void
  onEdit: () => void
  onDelete: () => void
  onTag: (tag: string) => void
}

export function BookmarkCard({ bookmark, selectedTags, onToggleRead, onEdit, onDelete, onTag }: Props) {
  const [menu, setMenu] = useState<MenuState>('closed')
  // A broken icon link falls back to the host's first letter.
  const [iconBroken, setIconBroken] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const host = hostOf(bookmark.url)
  const read = bookmark.readAt !== null

  // While the menu is open, a click elsewhere or Escape shuts it.
  useEffect(() => {
    if (menu === 'closed') return
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu('closed')
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu('closed')
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <li className={read ? 'card read' : 'card'}>
      <div className="card-head">
        {bookmark.iconUrl !== null && !iconBroken ? (
          <img className="icon" src={bookmark.iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setIconBroken(true)} />
        ) : (
          <span className="icon letter" aria-hidden="true">{host.charAt(0).toUpperCase()}</span>
        )}
        <div className="card-title">
          <h2>
            <a href={bookmark.url} target="_blank" rel="noopener noreferrer">{bookmark.title}</a>
          </h2>
          <span className="host">{host}</span>
        </div>
        <div className="menu" ref={menuRef}>
          <button
            type="button"
            className="menu-button"
            aria-label={`More for ${bookmark.title}`}
            aria-expanded={menu !== 'closed'}
            onClick={() => setMenu(menu === 'closed' ? 'open' : 'closed')}
          >
            ⋯
          </button>
          {menu === 'open' && (
            <div className="menu-list" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenu('closed'); onEdit() }}>Edit</button>
              <button type="button" role="menuitem" className="danger" onClick={() => setMenu('confirm')}>Delete</button>
            </div>
          )}
          {menu === 'confirm' && (
            <div className="menu-list" role="alertdialog" aria-label="Delete this bookmark?">
              <p>Delete this bookmark?</p>
              <button type="button" className="danger" onClick={() => { setMenu('closed'); onDelete() }}>Delete</button>
              <button type="button" onClick={() => setMenu('closed')}>Keep</button>
            </div>
          )}
        </div>
      </div>
      {bookmark.description !== null && <p className="description">{bookmark.description}</p>}
      <div className="card-foot">
        <ul className="card-tags" aria-label="Tags">
          {bookmark.tags.map((tag) => (
            <li key={tag}>
              <button type="button" className="chip small" aria-pressed={selectedTags.includes(tag)} onClick={() => onTag(tag)}>
                {tag}
              </button>
            </li>
          ))}
        </ul>
        <time dateTime={bookmark.createdAt}>{formatDate(bookmark.createdAt)}</time>
        <button type="button" className="read-toggle" aria-pressed={read} onClick={onToggleRead}>
          {read ? '✓ Read' : 'Mark read'}
        </button>
      </div>
    </li>
  )
}
