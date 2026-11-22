// The add and edit form, in a modal <dialog>. When adding, a pasted link (or one typed and
// left) is read by the server's preview, which fills the title and description the user has
// not typed in themselves. A link already saved shows "Already saved" with a way to open it.
import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import type { Bookmark, Issue, TagCount } from '../../../shared/types.ts'
import { ApiError, createBookmark, fetchPreview, updateBookmark } from '../api.ts'
import { hostOf, isWebUrl, messageOf } from '../format.ts'
import { TagInput } from './TagInput.tsx'

// The server's limits, so the form stops at the same place.
const URL_MAX = 2048
const TITLE_MAX = 300
const DESCRIPTION_MAX = 1000

// What the dialog is for: a new link, or changing one already saved.
export type DialogMode = { mode: 'add' } | { mode: 'edit'; bookmark: Bookmark }

interface Props {
  mode: DialogMode
  knownTags: TagCount[]
  onClose: () => void
  onSaved: (bookmark: Bookmark) => void
  onOpenExisting: (bookmark: Bookmark) => void
}

export function BookmarkDialog({ mode, knownTags, onClose, onSaved, onOpenExisting }: Props) {
  const editing = mode.mode === 'edit' ? mode.bookmark : null
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [url, setUrl] = useState(editing?.url ?? '')
  const [title, setTitle] = useState(editing?.title ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [tags, setTags] = useState<string[]>(editing?.tags ?? [])
  const [iconUrl, setIconUrl] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewNote, setPreviewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [issues, setIssues] = useState<Issue[]>([])
  const [formError, setFormError] = useState('')
  const [existing, setExisting] = useState<Bookmark | null>(null)
  // Which fields the user typed in; a preview never overwrites those.
  const touched = useRef({ title: false, description: false })
  // The last link sent to the preview, so the same link is not read twice and a slow answer
  // for an older link is ignored.
  const lastPreviewed = useRef('')

  // Opens as a modal: the page behind is inert and Escape closes it.
  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  // The first issue the server named for a field (tag issues come as "tags" or "tags.3").
  const issueFor = (field: string) => issues.find((issue) => issue.field === field || issue.field.startsWith(`${field}.`))?.message

  // Fills the fields the user has not typed in.
  function fill(newTitle: string, newDescription: string | null) {
    if (!touched.current.title) setTitle(newTitle)
    if (!touched.current.description && newDescription !== null) setDescription(newDescription)
  }

  // Reads the page behind a link and fills the form from it; on failure the title falls back
  // to the host name.
  async function preview(link: string) {
    const target = link.trim()
    if (editing !== null || !isWebUrl(target) || target === lastPreviewed.current) return
    lastPreviewed.current = target
    setPreviewing(true)
    setPreviewNote('')
    try {
      const found = await fetchPreview(target)
      if (lastPreviewed.current !== target) return
      fill(found.title ?? hostOf(target), found.description)
      setIconUrl(found.iconUrl)
    } catch {
      if (lastPreviewed.current !== target) return
      fill(hostOf(target), null)
      setIconUrl(null)
      setPreviewNote('Could not read that page. Fill in the details yourself.')
    } finally {
      if (lastPreviewed.current === target) setPreviewing(false)
    }
  }

  // A link pasted over the whole box is read at once, without waiting for the box to lose focus.
  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const replacesAll = input.selectionStart === 0 && input.selectionEnd === input.value.length
    if (replacesAll) void preview(event.clipboardData.getData('text'))
  }

  // Sends the new bookmark or the changes.
  function save(): Promise<Bookmark> {
    const cleanTitle = title.trim()
    const cleanDescription = description.trim()
    if (editing !== null) {
      return updateBookmark(editing.id, { title: cleanTitle, description: cleanDescription || null, tags })
    }
    return createBookmark({
      url: url.trim(),
      title: cleanTitle,
      description: cleanDescription || undefined,
      iconUrl: iconUrl ?? undefined,
      tags,
    })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setIssues([])
    setFormError('')
    setExisting(null)
    try {
      onSaved(await save())
    } catch (error) {
      // 409: the link is saved already; offer that one.
      if (error instanceof ApiError && error.existing !== null) setExisting(error.existing)
      // 400: show each problem under its field.
      else if (error instanceof ApiError && error.issues.length > 0) setIssues(error.issues)
      else setFormError(messageOf(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose} aria-labelledby="dialog-title">
      <form onSubmit={(event) => void submit(event)} noValidate>
        <h2 id="dialog-title">{editing === null ? 'Add a link' : 'Edit bookmark'}</h2>

        <label htmlFor="field-url">Link</label>
        <input
          id="field-url"
          type="url"
          required
          maxLength={URL_MAX}
          placeholder="https://"
          value={url}
          readOnly={editing !== null}
          autoFocus={editing === null}
          aria-invalid={issueFor('url') !== undefined}
          onChange={(event) => setUrl(event.target.value)}
          onPaste={onPaste}
          onBlur={() => void preview(url)}
        />
        {previewing && <p className="hint">Reading the page…</p>}
        {previewNote !== '' && <p className="hint">{previewNote}</p>}
        {issueFor('url') !== undefined && <p className="error">{issueFor('url')}</p>}

        {existing !== null && (
          <div className="duplicate" role="alert">
            <strong>Already saved</strong> as “{existing.title}”.
            <button type="button" onClick={() => onOpenExisting(existing)}>Open it</button>
          </div>
        )}

        <label htmlFor="field-title">Title</label>
        <input
          id="field-title"
          required
          maxLength={TITLE_MAX}
          value={title}
          autoFocus={editing !== null}
          aria-invalid={issueFor('title') !== undefined}
          onChange={(event) => {
            touched.current.title = true
            setTitle(event.target.value)
          }}
        />
        {issueFor('title') !== undefined && <p className="error">{issueFor('title')}</p>}

        <label htmlFor="field-description">Description</label>
        <textarea
          id="field-description"
          rows={3}
          maxLength={DESCRIPTION_MAX}
          value={description}
          onChange={(event) => {
            touched.current.description = true
            setDescription(event.target.value)
          }}
        />
        {issueFor('description') !== undefined && <p className="error">{issueFor('description')}</p>}

        <label htmlFor="field-tags">Tags</label>
        <TagInput id="field-tags" tags={tags} known={knownTags} onChange={setTags} />
        {issueFor('tags') !== undefined && <p className="error">{issueFor('tags')}</p>}

        {formError !== '' && <p className="error" role="alert">{formError}</p>}

        <div className="dialog-actions">
          <button type="button" onClick={() => dialogRef.current?.close()}>Cancel</button>
          <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </dialog>
  )
}
