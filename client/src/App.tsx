// The whole page: top bar, tag row, the list of cards, and the add/edit dialog.
// The filters live in the address bar, so a filtered view survives a reload and Back undoes
// a filter change. Read toggles and deletes show at once and are rolled back if the server
// refuses them.

import { useCallback, useEffect, useState } from 'react'
import type { Bookmark, BookmarkPage, TagCount } from '../../shared/types.ts'
import { deleteBookmark, listBookmarks, listTags, startOver, updateBookmark } from './api.ts'
import { messageOf } from './format.ts'
import { type Filters, filtersToSearch, hasFilters, NO_FILTERS, parseFilters, toggleTag } from './filters.ts'
import { TopBar } from './components/TopBar.tsx'
import { TagRow } from './components/TagRow.tsx'
import { BookmarkCard } from './components/BookmarkCard.tsx'
import { BookmarkDialog, type DialogMode } from './components/BookmarkDialog.tsx'
import { EmptyState } from './components/EmptyState.tsx'

// How long a toast message stays up, in milliseconds.
const TOAST_MS = 4000

// Where the first page stands.
type LoadState = 'loading' | 'ready' | 'error'

// Whether an error is the abort of a request this page cancelled itself.
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

// The filters, kept in step with the address bar. `replace` changes the current history entry
// instead of adding one, for search typing that should not fill Back with every letter.
function useUrlFilters(): [Filters, (next: Filters, replace?: boolean) => void] {
  const [filters, setFilters] = useState(() => parseFilters(window.location.search))

  // Back and Forward move between filter states.
  useEffect(() => {
    const onPop = () => setFilters(parseFilters(window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const update = useCallback((next: Filters, replace = false) => {
    const address = `${window.location.pathname}${filtersToSearch(next)}`
    const method = replace ? 'replaceState' : 'pushState'
    window.history[method](null, '', address)
    setFilters(next)
  }, [])

  return [filters, update]
}

export default function App() {
  const [filters, setFilters] = useUrlFilters()
  const [page, setPage] = useState<BookmarkPage>({ items: [], nextCursor: null })
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [tags, setTags] = useState<TagCount[]>([])
  const [dialog, setDialog] = useState<DialogMode | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // Bumped to load the list and the tags again after a save or "Start over".
  const [version, setVersion] = useState(0)

  const reload = useCallback(() => setVersion((current) => current + 1), [])

  // The first page for the current filters. A newer load aborts the older one, so a slow
  // answer for an old filter can never replace the list for the new one.
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoadState('loading')
      try {
        setPage(await listBookmarks(filters, null, controller.signal))
        setLoadState('ready')
      } catch (error) {
        if (isAbort(error)) return
        setLoadError(messageOf(error))
        setLoadState('error')
      }
    }
    void load()
    return () => controller.abort()
  }, [filters, version])

  // Bumped to fetch the tag counts alone again, after a delete.
  const [tagsVersion, setTagsVersion] = useState(0)

  // The tag counts, fetched again whenever they may have changed. An answer that arrives after
  // a newer fetch started is dropped.
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        setTags(await listTags(controller.signal))
      } catch (error) {
        if (!isAbort(error)) setToast(messageOf(error))
      }
    }
    void load()
    return () => controller.abort()
  }, [version, tagsVersion])

  // Hides the toast after a while; a new message restarts the timer.
  useEffect(() => {
    if (toast === null) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  // Puts a changed bookmark in place of the old one.
  const replaceItem = (bookmark: Bookmark) =>
    setPage((current) => ({ ...current, items: current.items.map((item) => (item.id === bookmark.id ? bookmark : item)) }))

  // Marks read or unread at once, then asks the server; puts it back if the server says no.
  async function toggleRead(bookmark: Bookmark) {
    const read = bookmark.readAt === null
    replaceItem({ ...bookmark, readAt: read ? new Date().toISOString() : null })
    try {
      replaceItem(await updateBookmark(bookmark.id, { read }))
    } catch (error) {
      replaceItem(bookmark)
      setToast(messageOf(error))
    }
  }

  // Removes the card at once, then asks the server; puts it back where it was on failure.
  async function remove(bookmark: Bookmark) {
    const index = page.items.findIndex((item) => item.id === bookmark.id)
    setPage((current) => ({ ...current, items: current.items.filter((item) => item.id !== bookmark.id) }))
    try {
      await deleteBookmark(bookmark.id)
      setTagsVersion((current) => current + 1)
    } catch (error) {
      setPage((current) => ({ ...current, items: current.items.toSpliced(index, 0, bookmark) }))
      setToast(messageOf(error))
    }
  }

  // Appends the next page.
  async function loadMore() {
    if (page.nextCursor === null) return
    setLoadingMore(true)
    try {
      const next = await listBookmarks(filters, page.nextCursor)
      setPage((current) => ({ items: [...current.items, ...next.items], nextCursor: next.nextCursor }))
    } catch (error) {
      setToast(messageOf(error))
    } finally {
      setLoadingMore(false)
    }
  }

  // A save in the dialog: close it and load fresh, since the new card's place and the tag
  // counts both depend on the server.
  function saved() {
    setDialog(null)
    reload()
  }

  // Forgets this list and starts a new one with the samples, after asking.
  async function handleStartOver() {
    if (!window.confirm('Start a new reading list? This browser will forget the current one.')) return
    try {
      await startOver()
      setFilters(NO_FILTERS)
      reload()
    } catch (error) {
      setToast(messageOf(error))
    }
  }

  // A tag clicked on a card or in the tag row joins (or leaves) the filter.
  const onToggleTag = (tag: string) => setFilters({ ...filters, tags: toggleTag(filters.tags, tag) })

  // The middle of the page, by load state.
  function renderList() {
    if (loadState === 'error') {
      return (
        <EmptyState title="Could not load your list" text={loadError}>
          <button type="button" onClick={reload}>Try again</button>
        </EmptyState>
      )
    }
    if (page.items.length === 0 && loadState === 'loading') return <p className="loading">Loading…</p>
    if (page.items.length === 0 && hasFilters(filters)) {
      return (
        <EmptyState title="No matches" text="Nothing saved fits these filters.">
          <button type="button" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>
        </EmptyState>
      )
    }
    if (page.items.length === 0) {
      return (
        <EmptyState title="Nothing saved yet" text="Save a link to start your reading list.">
          <button type="button" className="primary" onClick={() => setDialog({ mode: 'add' })}>Add a link</button>
        </EmptyState>
      )
    }
    return (
      <>
        {/* Dimmed while a new filter's results are on their way. */}
        <ul className="cards" aria-busy={loadState === 'loading'}>
          {page.items.map((bookmark) => (
            <BookmarkCard
              key={bookmark.id}
              bookmark={bookmark}
              selectedTags={filters.tags}
              onToggleRead={() => void toggleRead(bookmark)}
              onEdit={() => setDialog({ mode: 'edit', bookmark })}
              onDelete={() => void remove(bookmark)}
              onTag={onToggleTag}
            />
          ))}
        </ul>
        {page.nextCursor !== null && (
          <button type="button" className="load-more" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </>
    )
  }

  return (
    <div className="app">
      <TopBar filters={filters} onChange={setFilters} onAdd={() => setDialog({ mode: 'add' })} />
      <TagRow
        tags={tags}
        selected={filters.tags}
        onToggle={onToggleTag}
        onClear={() => setFilters({ ...filters, tags: [] })}
      />
      <main>{renderList()}</main>
      <footer className="footer">
        Your list is kept in this browser.{' '}
        <button type="button" className="link" onClick={() => void handleStartOver()}>Start over</button>
      </footer>
      {dialog !== null && (
        <BookmarkDialog
          // A new key gives the dialog fresh fields when it switches from add to edit.
          key={dialog.mode === 'edit' ? dialog.bookmark.id : 'add'}
          mode={dialog}
          knownTags={tags}
          onClose={() => setDialog(null)}
          onSaved={saved}
          onOpenExisting={(bookmark) => setDialog({ mode: 'edit', bookmark })}
        />
      )}
      {toast !== null && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
