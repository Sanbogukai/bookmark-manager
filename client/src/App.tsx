// The whole page: top bar, tag row, the list of cards, and the add/edit dialog.
// The filters live in the address bar, so a filtered view survives a reload and Back undoes
// a filter change. Read toggles and deletes show at once and are rolled back if the server
// refuses them.

// React's hooks: memoised callbacks, effects and state.
import { useCallback, useEffect, useState } from 'react'
// The shapes the server sends.
import type { Bookmark, BookmarkPage, TagCount } from '../../shared/types.ts'
// The server calls this page makes.
import { deleteBookmark, listBookmarks, listTags, startOver, updateBookmark } from './api.ts'
// Readable text from any error.
import { messageOf } from './format.ts'
// The filters: their shape, to and from the address bar, and the empty set.
import { type Filters, filtersToSearch, hasFilters, NO_FILTERS, parseFilters, toggleTag } from './filters.ts'
// The page's parts.
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
  // fetch rejects with a DOMException named AbortError when its signal is aborted.
  return error instanceof DOMException && error.name === 'AbortError'
}

// The filters, kept in step with the address bar. `replace` changes the current history entry
// instead of adding one, for search typing that should not fill Back with every letter.
function useUrlFilters(): [Filters, (next: Filters, replace?: boolean) => void] {
  // Read from the address once, on the first render.
  const [filters, setFilters] = useState(() => parseFilters(window.location.search))

  // Back and Forward move between filter states.
  useEffect(() => {
    // The browser has already changed the address; read the filters back out of it.
    const onPop = () => setFilters(parseFilters(window.location.search))
    // Listen while the page is up, and stop when it goes.
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Sets new filters: writes them into the address, then into state.
  const update = useCallback((next: Filters, replace = false) => {
    // Same path, new query string.
    const address = `${window.location.pathname}${filtersToSearch(next)}`
    // pushState adds a history entry; replaceState overwrites the current one.
    const method = replace ? 'replaceState' : 'pushState'
    // Changes the address without reloading the page.
    window.history[method](null, '', address)
    setFilters(next)
  }, [])

  // Used like useState: the value and its setter.
  return [filters, update]
}

// The page.
export default function App() {
  // The filters, kept in the address bar.
  const [filters, setFilters] = useUrlFilters()
  // The cards loaded so far, and the cursor for the next page (null when there is none).
  const [page, setPage] = useState<BookmarkPage>({ items: [], nextCursor: null })
  // The first page's state, for the loading and error messages.
  const [loadState, setLoadState] = useState<LoadState>('loading')
  // The message when the first page failed.
  const [loadError, setLoadError] = useState('')
  // True while Load more is fetching.
  const [loadingMore, setLoadingMore] = useState(false)
  // The tag row's tags and counts.
  const [tags, setTags] = useState<TagCount[]>([])
  // The open dialog (add or edit), or null when none is open.
  const [dialog, setDialog] = useState<DialogMode | null>(null)
  // A short message at the bottom, for failures that do not replace the list.
  const [toast, setToast] = useState<string | null>(null)
  // Bumped to load the list and the tags again after a save or "Start over".
  const [version, setVersion] = useState(0)

  // Loads the list and tags again by bumping the version the effects watch.
  const reload = useCallback(() => setVersion((current) => current + 1), [])

  // The first page for the current filters. A newer load aborts the older one, so a slow
  // answer for an old filter can never replace the list for the new one.
  useEffect(() => {
    // Lets this load be cancelled.
    const controller = new AbortController()
    // Effects cannot be async themselves, so the work is in an inner function.
    async function load() {
      setLoadState('loading')
      try {
        // The first page (no cursor) for these filters.
        setPage(await listBookmarks(filters, null, controller.signal))
        setLoadState('ready')
      } catch (error) {
        // Cancelled on purpose by a newer load: not a failure.
        if (isAbort(error)) return
        setLoadError(messageOf(error))
        setLoadState('error')
      }
    }
    // Starts it without waiting.
    void load()
    // Runs before the next load and on unmount, cancelling this one.
    return () => controller.abort()
  // Again whenever the filters change or a reload is asked for.
  }, [filters, version])

  // Bumped to fetch the tag counts alone again, after a delete.
  const [tagsVersion, setTagsVersion] = useState(0)

  // The tag counts, fetched again whenever they may have changed. An answer that arrives after
  // a newer fetch started is dropped.
  useEffect(() => {
    // Lets this fetch be cancelled.
    const controller = new AbortController()
    async function load() {
      try {
        setTags(await listTags(controller.signal))
      } catch (error) {
        // A tags failure leaves the list usable, so it only shows a toast.
        if (!isAbort(error)) setToast(messageOf(error))
      }
    }
    void load()
    // Cancels this fetch when a newer one starts.
    return () => controller.abort()
  }, [version, tagsVersion])

  // Hides the toast after a while; a new message restarts the timer.
  useEffect(() => {
    // Nothing showing: no timer.
    if (toast === null) return
    // Hides it after TOAST_MS.
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    // A newer toast clears this timer.
    return () => clearTimeout(timer)
  }, [toast])

  // Puts a changed bookmark in place of the old one.
  const replaceItem = (bookmark: Bookmark) =>
    setPage((current) => ({ ...current, items: current.items.map((item) => (item.id === bookmark.id ? bookmark : item)) }))

  // Marks read or unread at once, then asks the server; puts it back if the server says no.
  async function toggleRead(bookmark: Bookmark) {
    // The new state: an unread bookmark becomes read, and the other way round.
    const read = bookmark.readAt === null
    // Shows the change at once, with a read time from this browser's clock.
    replaceItem({ ...bookmark, readAt: read ? new Date().toISOString() : null })
    try {
      // Swaps in the server's version, with its own read time.
      replaceItem(await updateBookmark(bookmark.id, { read }))
    } catch (error) {
      // Refused: back to how it was, and say why.
      replaceItem(bookmark)
      setToast(messageOf(error))
    }
  }

  // Removes the card at once, then asks the server; puts it back where it was on failure.
  async function remove(bookmark: Bookmark) {
    // Remembers the card's place, to put it back there on failure.
    const index = page.items.findIndex((item) => item.id === bookmark.id)
    // Takes the card out at once.
    setPage((current) => ({ ...current, items: current.items.filter((item) => item.id !== bookmark.id) }))
    try {
      // Asks the server.
      await deleteBookmark(bookmark.id)
      // A tag may now have no bookmarks, so the counts are fetched again.
      setTagsVersion((current) => current + 1)
    } catch (error) {
      // Refused: back where it was, and say why.
      setPage((current) => ({ ...current, items: current.items.toSpliced(index, 0, bookmark) }))
      setToast(messageOf(error))
    }
  }

  // Appends the next page.
  async function loadMore() {
    // No more pages.
    if (page.nextCursor === null) return
    // Turns the button into "Loading…".
    setLoadingMore(true)
    try {
      // The page after the last card loaded.
      const next = await listBookmarks(filters, page.nextCursor)
      // Adds its cards to the end and keeps its cursor for the next time.
      setPage((current) => ({ items: [...current.items, ...next.items], nextCursor: next.nextCursor }))
    } catch (error) {
      // The cards already shown stay; the toast says what went wrong.
      setToast(messageOf(error))
    } finally {
      // The button works again either way.
      setLoadingMore(false)
    }
  }

  // A save in the dialog: close it and load fresh, since the new card's place and the tag
  // counts both depend on the server.
  function saved() {
    // Closes the dialog.
    setDialog(null)
    // Loads the list and the tags again.
    reload()
  }

  // Forgets this list and starts a new one with the samples, after asking.
  async function handleStartOver() {
    // The browser's own yes/no box; No leaves everything as it is.
    if (!window.confirm('Start a new reading list? This browser will forget the current one.')) return
    try {
      // Drops the old key and gets a new owner with fresh samples.
      await startOver()
      // The new list starts unfiltered.
      setFilters(NO_FILTERS)
      // Loads it.
      reload()
    } catch (error) {
      // The old list stays; the toast says what went wrong.
      setToast(messageOf(error))
    }
  }

  // A tag clicked on a card or in the tag row joins (or leaves) the filter.
  const onToggleTag = (tag: string) => setFilters({ ...filters, tags: toggleTag(filters.tags, tag) })

  // The middle of the page, by load state.
  function renderList() {
    // The first page failed: say so, with a retry.
    if (loadState === 'error') {
      return (
        <EmptyState title="Could not load your list" text={loadError}>
          <button type="button" onClick={reload}>Try again</button>
        </EmptyState>
      )
    }
    // Nothing to show yet and still loading.
    if (page.items.length === 0 && loadState === 'loading') return <p className="loading">Loading…</p>
    // Loaded, but the filters match nothing: offer to clear them.
    if (page.items.length === 0 && hasFilters(filters)) {
      return (
        <EmptyState title="No matches" text="Nothing saved fits these filters.">
          <button type="button" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>
        </EmptyState>
      )
    }
    // Loaded and filters off, but the list is empty: offer to add a link.
    if (page.items.length === 0) {
      return (
        <EmptyState title="Nothing saved yet" text="Save a link to start your reading list.">
          <button type="button" className="primary" onClick={() => setDialog({ mode: 'add' })}>Add a link</button>
        </EmptyState>
      )
    }
    // The cards, then Load more when there is another page.
    return (
      <>
        {/* Dimmed while a new filter's results are on their way. */}
        <ul className="cards" aria-busy={loadState === 'loading'}>
          {/* One card per bookmark; key lets React match cards between renders. */}
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
        {/* Load more only while the server says there is another page. */}
        {page.nextCursor !== null && (
          // Off while loading, so the same page is not asked for twice.
          <button type="button" className="load-more" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </>
    )
  }

  return (
    // The whole page.
    <div className="app">
      {/* Search, status switch and Add. */}
      <TopBar filters={filters} onChange={setFilters} onAdd={() => setDialog({ mode: 'add' })} />
      {/* The tag chips; Clear turns every tag filter off. */}
      <TagRow
        tags={tags}
        selected={filters.tags}
        onToggle={onToggleTag}
        onClear={() => setFilters({ ...filters, tags: [] })}
      />
      {/* The list, its loading or error message, or an empty state. */}
      <main>{renderList()}</main>
      {/* Reminds that the list lives in this browser, with the way to start a fresh one. */}
      <footer className="footer">
        Your list is kept in this browser.{' '}
        <button type="button" className="link" onClick={() => void handleStartOver()}>Start over</button>
      </footer>
      {/* The add or edit dialog, only while one is open. */}
      {dialog !== null && (
        <BookmarkDialog
          // A new key gives the dialog fresh fields when it switches from add to edit.
          key={dialog.mode === 'edit' ? dialog.bookmark.id : 'add'}
          // Add or edit, and the bookmark for edit.
          mode={dialog}
          // For the tag field's suggestions.
          knownTags={tags}
          // Cancel, Escape or a save: no dialog.
          onClose={() => setDialog(null)}
          // Close and reload.
          onSaved={saved}
          // After a 409: switch to editing the bookmark already saved under that link.
          onOpenExisting={(bookmark) => setDialog({ mode: 'edit', bookmark })}
        />
      )}
      {/* The toast; role="status" has screen readers read it without moving focus. */}
      {toast !== null && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
