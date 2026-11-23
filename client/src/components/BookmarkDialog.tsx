// The add and edit form, in a modal <dialog>. When adding, a pasted link (or one typed and
// left) is read by the server's preview, which fills the title and description the user has
// not typed in themselves. A link already saved shows "Already saved" with a way to open it.

// Event types, and React's effect, ref and state hooks.
import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from 'react'
// The shapes the server sends: a bookmark, one problem with a field, a tag with its count.
import type { Bookmark, Issue, TagCount } from '../../../shared/types.ts'
// The calls this form makes, and the error type that carries the server's issues.
import { ApiError, createBookmark, fetchPreview, updateBookmark } from '../api.ts'
// Host name from a link, a quick "is this a web link" test, and readable error text.
import { hostOf, isWebUrl, messageOf } from '../format.ts'
// The chip-style tag field.
import { TagInput } from './TagInput.tsx'

// The server's limits, so the form stops at the same place.
const URL_MAX = 2048
const TITLE_MAX = 300
const DESCRIPTION_MAX = 1000

// What the dialog is for: a new link, or changing one already saved.
export type DialogMode = { mode: 'add' } | { mode: 'edit'; bookmark: Bookmark }

// What App hands in.
interface Props {
  // Add or edit, and for edit, which bookmark.
  mode: DialogMode
  // Tags already in use, for the tag field's suggestions.
  knownTags: TagCount[]
  // Called when the dialog shuts, by Cancel, Escape or saving.
  onClose: () => void
  // Called with the saved bookmark.
  onSaved: (bookmark: Bookmark) => void
  // Switches to editing the bookmark already saved under this link.
  onOpenExisting: (bookmark: Bookmark) => void
}

// The dialog itself.
export function BookmarkDialog({ mode, knownTags, onClose, onSaved, onOpenExisting }: Props) {
  // The bookmark being changed, or null when adding.
  const editing = mode.mode === 'edit' ? mode.bookmark : null
  // The <dialog> element, to open and close it.
  const dialogRef = useRef<HTMLDialogElement>(null)
  // The fields, starting from the bookmark when editing and empty when adding.
  const [url, setUrl] = useState(editing?.url ?? '')
  const [title, setTitle] = useState(editing?.title ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [tags, setTags] = useState<string[]>(editing?.tags ?? [])
  // The icon the preview found; it is sent with a new bookmark but never shown in the form.
  const [iconUrl, setIconUrl] = useState<string | null>(null)
  // True while the preview request is out, for the "Reading the page…" line.
  const [previewing, setPreviewing] = useState(false)
  // A note when the page could not be read.
  const [previewNote, setPreviewNote] = useState('')
  // True while saving, so Save cannot be pressed twice.
  const [saving, setSaving] = useState(false)
  // The server's 400 problems, shown under their fields.
  const [issues, setIssues] = useState<Issue[]>([])
  // Any other failure, shown above the buttons.
  const [formError, setFormError] = useState('')
  // The bookmark already saved under this link, after a 409.
  const [existing, setExisting] = useState<Bookmark | null>(null)
  // Which fields the user typed in; a preview never overwrites those.
  const touched = useRef({ title: false, description: false })
  // The last link sent to the preview, so the same link is not read twice and a slow answer
  // for an older link is ignored.
  const lastPreviewed = useRef('')

  // Opens as a modal: the page behind is inert and Escape closes it.
  useEffect(() => {
    dialogRef.current?.showModal()
    // Once, when the dialog first appears.
  }, [])

  // The first issue the server named for a field (tag issues come as "tags" or "tags.3").
  const issueFor = (field: string) => issues.find((issue) => issue.field === field || issue.field.startsWith(`${field}.`))?.message

  // Fills the fields the user has not typed in.
  function fill(newTitle: string, newDescription: string | null) {
    if (!touched.current.title) setTitle(newTitle)
    // A page with no description leaves the field as it is.
    if (!touched.current.description && newDescription !== null) setDescription(newDescription)
  }

  // Reads the page behind a link and fills the form from it; on failure the title falls back
  // to the host name.
  async function preview(link: string) {
    // Spaces around a pasted link do not count.
    const target = link.trim()
    // Only when adding, only for a web link, and only once per link.
    if (editing !== null || !isWebUrl(target) || target === lastPreviewed.current) return
    // Marks this link as the one being read.
    lastPreviewed.current = target
    setPreviewing(true)
    setPreviewNote('')
    try {
      // The server fetches the page and answers with its title, description and icon.
      const found = await fetchPreview(target)
      // The link changed while this was out: a newer preview owns the form.
      if (lastPreviewed.current !== target) return
      // A page with no title gets its host name instead.
      fill(found.title ?? hostOf(target), found.description)
      setIconUrl(found.iconUrl)
    } catch {
      // Same check for a failure that arrives late.
      if (lastPreviewed.current !== target) return
      // The host name still makes a usable title.
      fill(hostOf(target), null)
      setIconUrl(null)
      setPreviewNote('Could not read that page. Fill in the details yourself.')
    } finally {
      // Only the latest preview turns the "Reading" line off.
      if (lastPreviewed.current === target) setPreviewing(false)
    }
  }

  // A link pasted over the whole box is read at once, without waiting for the box to lose focus.
  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const input = event.currentTarget
    // True when the box was empty or its whole text was selected, so the paste is the full link.
    const replacesAll = input.selectionStart === 0 && input.selectionEnd === input.value.length
    // The pasted text comes from the clipboard, since the box has not updated yet.
    if (replacesAll) void preview(event.clipboardData.getData('text'))
  }

  // Sends the new bookmark or the changes.
  function save(): Promise<Bookmark> {
    // Spaces at the ends are dropped before sending.
    const cleanTitle = title.trim()
    const cleanDescription = description.trim()
    // Editing: the link cannot change; an empty description clears it.
    if (editing !== null) {
      return updateBookmark(editing.id, { title: cleanTitle, description: cleanDescription || null, tags })
    }
    // Adding: empty optional fields are left out.
    return createBookmark({
      url: url.trim(),
      title: cleanTitle,
      description: cleanDescription || undefined,
      iconUrl: iconUrl ?? undefined,
      tags,
    })
  }

  // Save: sends the form and shows whatever went wrong.
  async function submit(event: FormEvent) {
    // Stops the browser sending the form and reloading the page.
    event.preventDefault()
    // Clears the last attempt's messages.
    setSaving(true)
    setIssues([])
    setFormError('')
    setExisting(null)
    try {
      // Saved: App closes the dialog and reloads the list.
      onSaved(await save())
    } catch (error) {
      // 409: the link is saved already; offer that one.
      if (error instanceof ApiError && error.existing !== null) setExisting(error.existing)
      // 400: show each problem under its field.
      else if (error instanceof ApiError && error.issues.length > 0) setIssues(error.issues)
      // Anything else (offline, 500): one message above the buttons.
      else setFormError(messageOf(error))
    } finally {
      // Save can be pressed again either way.
      setSaving(false)
    }
  }

  return (
    // The native dialog; closing it by any means calls onClose. The heading names it.
    <dialog ref={dialogRef} className="dialog" onClose={onClose} aria-labelledby="dialog-title">
      {/* noValidate: the server's messages are shown instead of the browser's own pop-ups. */}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <h2 id="dialog-title">{editing === null ? 'Add a link' : 'Edit bookmark'}</h2>

        {/* The link. */}
        <label htmlFor="field-url">Link</label>
        <input
          id="field-url"
          type="url"
          required
          maxLength={URL_MAX}
          placeholder="https://"
          value={url}
          // A saved bookmark's link is fixed; delete and add again to change it.
          readOnly={editing !== null}
          // Focus starts here when adding, on the title when editing.
          autoFocus={editing === null}
          // Marks the field as wrong for screen readers when the server named it.
          aria-invalid={issueFor('url') !== undefined}
          onChange={(event) => setUrl(event.target.value)}
          // A pasted link is read at once.
          onPaste={onPaste}
          // A typed link is read when the box is left.
          onBlur={() => void preview(url)}
        />
        {/* Preview progress, then any note about it, then the server's issue for the link. */}
        {previewing && <p className="hint">Reading the page…</p>}
        {previewNote !== '' && <p className="hint">{previewNote}</p>}
        {issueFor('url') !== undefined && <p className="error">{issueFor('url')}</p>}

        {/* After a 409: names the saved bookmark and offers to open it. role="alert" announces it. */}
        {existing !== null && (
          <div className="duplicate" role="alert">
            <strong>Already saved</strong> as “{existing.title}”.
            <button type="button" onClick={() => onOpenExisting(existing)}>Open it</button>
          </div>
        )}

        {/* The title. */}
        <label htmlFor="field-title">Title</label>
        <input
          id="field-title"
          required
          maxLength={TITLE_MAX}
          value={title}
          autoFocus={editing !== null}
          aria-invalid={issueFor('title') !== undefined}
          // Typing here marks the title as the user's, so a preview leaves it alone.
          onChange={(event) => {
            touched.current.title = true
            setTitle(event.target.value)
          }}
        />
        {issueFor('title') !== undefined && <p className="error">{issueFor('title')}</p>}

        {/* The description, optional. */}
        <label htmlFor="field-description">Description</label>
        <textarea
          id="field-description"
          rows={3}
          maxLength={DESCRIPTION_MAX}
          value={description}
          // Same as the title: typed text is never overwritten by a preview.
          onChange={(event) => {
            touched.current.description = true
            setDescription(event.target.value)
          }}
        />
        {issueFor('description') !== undefined && <p className="error">{issueFor('description')}</p>}

        {/* The tags, as chips. */}
        <label htmlFor="field-tags">Tags</label>
        <TagInput id="field-tags" tags={tags} known={knownTags} onChange={setTags} />
        {issueFor('tags') !== undefined && <p className="error">{issueFor('tags')}</p>}

        {/* Any failure not tied to one field. */}
        {formError !== '' && <p className="error" role="alert">{formError}</p>}

        <div className="dialog-actions">
          {/* Closing the dialog fires its close event, which calls onClose. */}
          <button type="button" onClick={() => dialogRef.current?.close()}>Cancel</button>
          {/* Off while saving, and says so. */}
          <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </dialog>
  )
}
