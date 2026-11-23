// A message in place of the list, with an action under it.

// The type for anything React can draw, used for the action passed in.
import type { ReactNode } from 'react'

// The title and text to show, and the action (usually a button) as children.
export function EmptyState({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    // A section, centred by the "empty" class.
    <section className="empty">
      {/* What is missing, as a heading. */}
      <h2>{title}</h2>
      {/* What to do about it. */}
      <p>{text}</p>
      {/* The action, as App passed it. */}
      {children}
    </section>
  )
}
