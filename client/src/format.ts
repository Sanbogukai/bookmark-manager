// Small text helpers for the cards and the add form.

// The host name a card shows under its title: "developer.mozilla.org", without a leading
// "www.", or the whole text if it is not a URL.
export function hostOf(url: string): string {
  if (!URL.canParse(url)) return url
  const { hostname } = new URL(url)
  return hostname.startsWith('www.') ? hostname.slice('www.'.length) : hostname
}

// Whether text is a web link the preview can read.
export function isWebUrl(text: string): boolean {
  if (!URL.canParse(text)) return false
  const { protocol } = new URL(text)
  return protocol === 'http:' || protocol === 'https:'
}

// "22 Nov 2026", in the reader's own language and order.
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// An ISO date-time as a short date.
export function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso))
}

// A message to show for anything thrown: ApiError messages are written to be shown as they are.
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}
