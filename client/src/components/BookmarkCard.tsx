// One saved link: icon, title, host, description, tags, date, the Read toggle and a small
// menu with Edit and Delete. Delete asks inside the menu before it goes ahead.

// React's state, ref and effect hooks.
import { useEffect, useRef, useState } from 'react'
// The bookmark shape the server sends.
import type { Bookmark } from '../../../shared/types.ts'
// "22 Nov 2026" from an ISO time, and "example.com" from a link.
import { formatDate, hostOf } from '../format.ts'

// Where the menu stands: shut, open, or asking whether to delete.
type MenuState = 'closed' | 'open' | 'confirm'

// What App hands in.
interface Props {
  // The bookmark to show.
  bookmark: Bookmark
  // The tags the list is filtered on, so this card's matching chips show as pressed.
  selectedTags: string[]
  // Flips the bookmark between read and unread.
  onToggleRead: () => void
  // Opens the edit dialog for this bookmark.
  onEdit: () => void
  // Deletes it; only called after the menu has asked.
  onDelete: () => void
  // Adds or removes a tag from the filter when its chip is clicked.
  onTag: (tag: string) => void
}

// The card itself.
export function BookmarkCard({ bookmark, selectedTags, onToggleRead, onEdit, onDelete, onTag }: Props) {
  // The menu starts shut.
  const [menu, setMenu] = useState<MenuState>('closed')
  // A broken icon link falls back to the host's first letter.
  const [iconBroken, setIconBroken] = useState(false)
  // The menu's box, so a click can be tested for being inside it.
  const menuRef = useRef<HTMLDivElement>(null)
  // The site's name, shown under the title and used for the letter icon.
  const host = hostOf(bookmark.url)
  // A bookmark is read once it has a read time.
  const read = bookmark.readAt !== null

  // While the menu is open, a click elsewhere or Escape shuts it.
  useEffect(() => {
    // Nothing to listen for while it is shut.
    if (menu === 'closed') return
    // A press outside the menu's box shuts it.
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu('closed')
    }
    // Escape shuts it from the keyboard.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu('closed')
    }
    // Listen on the whole page, since the click can land anywhere.
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    // Stop listening when the menu shuts or the card goes away.
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
    // Runs again each time the menu opens or shuts.
  }, [menu])

  return (
    // A list item, since the cards sit in a <ul>; read cards are dimmed by the "read" class.
    <li className={read ? 'card read' : 'card'}>
      {/* Top row: icon, title and host, menu. */}
      <div className="card-head">
        {/* The site's icon if there is one that loads; otherwise a letter. */}
        {bookmark.iconUrl !== null && !iconBroken ? (
          // Empty alt because the title next to it already names the site; no-referrer keeps the
          // list's address from being sent to the icon's site; onError swaps in the letter.
          <img className="icon" src={bookmark.iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setIconBroken(true)} />
        ) : (
          // The host's first letter, hidden from screen readers as decoration.
          <span className="icon letter" aria-hidden="true">{host.charAt(0).toUpperCase()}</span>
        )}
        {/* Title and host. */}
        <div className="card-title">
          <h2>
            {/* Opens the saved page in a new tab; noopener stops that page reaching back into this one. */}
            <a href={bookmark.url} target="_blank" rel="noopener noreferrer">{bookmark.title}</a>
          </h2>
          {/* The site's name, under the title. */}
          <span className="host">{host}</span>
        </div>
        {/* The ⋯ menu; the ref marks its box for the outside-click check above. */}
        <div className="menu" ref={menuRef}>
          <button
            type="button"
            className="menu-button"
            // The button shows only "⋯", so this names it for screen readers.
            aria-label={`More for ${bookmark.title}`}
            // Tells screen readers whether the menu is showing.
            aria-expanded={menu !== 'closed'}
            // Opens a shut menu, shuts an open one.
            onClick={() => setMenu(menu === 'closed' ? 'open' : 'closed')}
          >
            ⋯
          </button>
          {/* The open menu: Edit and Delete. */}
          {menu === 'open' && (
            <div className="menu-list" role="menu">
              {/* Shuts the menu, then opens the edit dialog. */}
              <button type="button" role="menuitem" onClick={() => { setMenu('closed'); onEdit() }}>Edit</button>
              {/* Does not delete yet: switches the menu to the question below. */}
              <button type="button" role="menuitem" className="danger" onClick={() => setMenu('confirm')}>Delete</button>
            </div>
          )}
          {/* The question asked before deleting. */}
          {menu === 'confirm' && (
            <div className="menu-list" role="alertdialog" aria-label="Delete this bookmark?">
              <p>Delete this bookmark?</p>
              {/* Shuts the menu and deletes. */}
              <button type="button" className="danger" onClick={() => { setMenu('closed'); onDelete() }}>Delete</button>
              {/* Shuts the menu and keeps it. */}
              <button type="button" onClick={() => setMenu('closed')}>Keep</button>
            </div>
          )}
        </div>
      </div>
      {/* The description, only when there is one. */}
      {bookmark.description !== null && <p className="description">{bookmark.description}</p>}
      {/* Bottom row: tags, date, Read toggle. */}
      <div className="card-foot">
        <ul className="card-tags" aria-label="Tags">
          {/* One chip per tag; key lets React match chips between renders. */}
          {bookmark.tags.map((tag) => (
            <li key={tag}>
              {/* aria-pressed shows whether the list is filtered on this tag; a click toggles that. */}
              <button type="button" className="chip small" aria-pressed={selectedTags.includes(tag)} onClick={() => onTag(tag)}>
                {tag}
              </button>
            </li>
          ))}
        </ul>
        {/* When it was saved, with the raw time for machines. */}
        <time dateTime={bookmark.createdAt}>{formatDate(bookmark.createdAt)}</time>
        {/* aria-pressed makes it a toggle for screen readers. */}
        <button type="button" className="read-toggle" aria-pressed={read} onClick={onToggleRead}>
          {/* Says what it is now when read, and what it does when not. */}
          {read ? '✓ Read' : 'Mark read'}
        </button>
      </div>
    </li>
  )
}
