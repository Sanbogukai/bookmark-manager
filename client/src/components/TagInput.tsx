// Tags typed as chips. A comma or Enter ends a tag, Backspace in an empty box removes the last
// one, and tags already in use are offered under the box.

// The keyboard event type, and React's state hook.
import { type KeyboardEvent, useState } from 'react'
// A tag name with how many bookmarks carry it.
import type { TagCount } from '../../../shared/types.ts'
// The tag rules, shared with the tests: tidy, split, suggest, and the most a bookmark can have.
import { addTags, normalizeTag, splitTyped, suggestTags, TAGS_MAX } from '../tags.ts'

// What the dialog hands in.
interface Props {
  // The input's id, so the dialog's <label> points at it.
  id: string
  // The tags chosen so far.
  tags: string[]
  // Every tag already in use, for suggestions.
  known: TagCount[]
  // Called with the new list whenever a tag is added or removed.
  onChange: (tags: string[]) => void
}

// The chips, the box, and the suggestions.
export function TagInput({ id, tags, known, onChange }: Props) {
  // What is typed in the box and not yet a tag.
  const [text, setText] = useState('')
  // Suggestions show only while the box has focus.
  const [focused, setFocused] = useState(false)
  // At the limit, the box is switched off.
  const full = tags.length >= TAGS_MAX
  // Known tags that start with the typed text and are not chosen yet.
  const suggestions = focused && !full ? suggestTags(text, tags, known) : []
  // A hint once the typed text could not be a tag.
  const invalid = text.trim() !== '' && normalizeTag(text) === null

  // Keeps what was typed before each comma as tags, and the rest in the box.
  function type(value: string) {
    // "a, b, c" gives names ["a", "b"] and rest " c".
    const { names, rest } = splitTyped(value)
    // Adds the finished names, skipping any already chosen.
    if (names.length > 0) onChange(addTags(tags, names))
    // After a comma, the space typed next is dropped so the box starts clean.
    setText(names.length > 0 ? rest.trimStart() : rest)
  }

  // Turns the box's text into a tag, if it can be one.
  function commit() {
    // Text that is not a valid tag stays in the box, with the hint under it.
    if (normalizeTag(text) === null) return
    // Adds it and empties the box.
    onChange(addTags(tags, [text]))
    setText('')
  }

  // Enter and Backspace have special jobs in this box.
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter ends a tag instead of sending the form, unless the box is empty.
    if (event.key === 'Enter' && text.trim() !== '') {
      event.preventDefault()
      commit()
    }
    // Backspace in an empty box removes the last chip.
    if (event.key === 'Backspace' && text === '' && tags.length > 0) onChange(tags.slice(0, -1))
  }

  return (
    <div className="tag-input">
      {/* The chips and the box, drawn as one field. */}
      <div className="tag-box">
        {/* One chip per chosen tag; key lets React match chips between renders. */}
        {tags.map((tag) => (
          <span key={tag} className="chip">
            {tag}
            {/* The × removes this tag; the label names it, since × alone says nothing. */}
            <button type="button" className="remove" aria-label={`Remove ${tag}`} onClick={() => onChange(tags.filter((name) => name !== tag))}>
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          // No more typing once the limit is reached.
          disabled={full}
          // Says why the box is off when full.
          placeholder={full ? `Up to ${TAGS_MAX} tags` : 'Add tags, comma between'}
          // The suggestions below replace the browser's own.
          autoComplete="off"
          // Each keystroke may finish a tag at a comma.
          onChange={(event) => type(event.target.value)}
          onKeyDown={onKeyDown}
          // Show suggestions while focused.
          onFocus={() => setFocused(true)}
          // Leaving the box hides them and keeps whatever was typed as a tag.
          onBlur={() => {
            setFocused(false)
            commit()
          }}
        />
      </div>
      {/* The rule, shown only when the typed text breaks it. */}
      {invalid && <p className="hint">Letters, digits and dashes only, up to 30 characters.</p>}
      {/* Tags already in use that match what is typed. */}
      {suggestions.length > 0 && (
        <div className="suggestions" aria-label="Suggested tags">
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              className="chip small"
              // Mouse down keeps the box focused, so the list stays open for another pick.
              onMouseDown={(event) => event.preventDefault()}
              // Adds the suggestion and clears the half-typed text.
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
