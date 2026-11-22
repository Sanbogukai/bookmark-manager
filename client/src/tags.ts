// The tag input's rules, the same as the server's: lower-case letters, digits and dashes,
// 1 to 30 characters, at most 10 per bookmark. Checking here lets the input refuse a bad
// tag as it is typed instead of waiting for a 400.

// The most tags one bookmark can carry.
export const TAGS_MAX = 10
// The longest a tag name can be; TAG_PATTERN below spells the same limit out.
export const TAG_LENGTH_MAX = 30
// The most suggestions shown under the input.
const SUGGESTIONS_MAX = 6

// A tag: 1 to 30 lower-case letters, digits or dashes.
// Example: "web-dev" and "postgres18" match; "web dev", "c++" and "" do not.
// Try it: https://regex101.com/?regex=%5E%5Ba-z0-9-%5D%7B1%2C30%7D%24&flavor=javascript&testString=web-dev
const TAG_PATTERN = /^[a-z0-9-]{1,30}$/

// Spaces inside what was typed become dashes, so "web dev" is kept as "web-dev".
// Example: "web  dev" matches at "  "; "web-dev" has no match.
// Try it: https://regex101.com/?regex=%5Cs%2B&flags=g&flavor=javascript&testString=web%20%20dev
const INNER_SPACE = /\s+/g

// Typed text as a tag name, or null if it cannot be one.
export function normalizeTag(text: string): string | null {
  const name = text.trim().toLowerCase().replace(INNER_SPACE, '-')
  return TAG_PATTERN.test(name) ? name : null
}

// What the tag input holds after a change: each comma ends a tag, and the text after the
// last comma stays in the box. "react, testing, vi" gives tags react and testing, and "vi".
export function splitTyped(text: string): { names: string[]; rest: string } {
  const parts = text.split(',')
  // The last part is still being typed.
  const rest = parts.at(-1) ?? ''
  return { names: parts.slice(0, -1), rest }
}

// `current` with each valid new name added once, stopping at TAGS_MAX.
export function addTags(current: string[], typed: string[]): string[] {
  const names = typed.map(normalizeTag).filter((name): name is string => name !== null)
  return [...new Set([...current, ...names])].slice(0, TAGS_MAX)
}

// Tags already in use that start with what is typed and are not chosen yet, the most used first.
export function suggestTags(typed: string, chosen: string[], known: { name: string; count: number }[]): string[] {
  const prefix = typed.trim().toLowerCase()
  return known
    .filter((tag) => tag.name.startsWith(prefix) && !chosen.includes(tag.name))
    .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, SUGGESTIONS_MAX)
    .map((tag) => tag.name)
}
