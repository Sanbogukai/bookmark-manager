// Tags typed as chips. A comma or Enter ends a tag, Backspace in an empty box removes the last
// one, and tags already in use are offered under the box.
import { type KeyboardEvent, useState } from 'react'
import type { TagCount } from '../../../shared/types.ts'
import { addTags, normalizeTag, splitTyped, suggestTags, TAGS_MAX } from '../tags.ts'

interface Props {
  id: string
  tags: string[]
  known: TagCount[]
  onChange: (tags: string[]) => void
}

export function TagInput({ id, tags, known, onChange }: Props) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const full = tags.length >= TAGS_MAX
  const suggestions = focused && !full ? suggestTags(text, tags, known) : []
  // A hint once the typed text could not be a tag.
  const invalid = text.trim() !== '' && normalizeTag(text) === null

  // Keeps what was typed before each comma as tags, and the rest in the box.
  function type(value: string) {
    const { names, rest } = splitTyped(value)
    if (names.length > 0) onChange(addTags(tags, names))
    setText(names.length > 0 ? rest.trimStart() : rest)
  }

  // Turns the box's text into a tag, if it can be one.
  function commit() {
    if (normalizeTag(text) === null) return
    onChange(addTags(tags, [text]))
    setText('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter ends a tag instead of sending the form, unless the box is empty.
    if (event.key === 'Enter' && text.trim() !== '') {
      event.preventDefault()
      commit()
    }
    if (event.key === 'Backspace' && text === '' && tags.length > 0) onChange(tags.slice(0, -1))
  }

  return (
    <div className="tag-input">
      <div className="tag-box">
        {tags.map((tag) => (
          <span key={tag} className="chip">
            {tag}
            <button type="button" className="remove" aria-label={`Remove ${tag}`} onClick={() => onChange(tags.filter((name) => name !== tag))}>
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          disabled={full}
          placeholder={full ? `Up to ${TAGS_MAX} tags` : 'Add tags, comma between'}
          autoComplete="off"
          onChange={(event) => type(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            commit()
          }}
        />
      </div>
      {invalid && <p className="hint">Letters, digits and dashes only, up to 30 characters.</p>}
      {suggestions.length > 0 && (
        <div className="suggestions" aria-label="Suggested tags">
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              className="chip small"
              // Mouse down keeps the box focused, so the list stays open for another pick.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(addTags(tags, [name]))
                setText('')
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
