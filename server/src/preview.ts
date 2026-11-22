// Reads a page's title, description and icon from its HTML, to fill in the add form.

// cheerio parses HTML and finds elements with CSS selectors, so no regular expressions are
// needed to read tags.
import { load } from 'cheerio';
// The shape the API returns.
import type { Preview } from '../../shared/types.ts';

// The longest title and description kept; the form's own limits are the same.
export const TITLE_MAX = 300;
export const DESCRIPTION_MAX = 1000;

// Most sites keep their icon here even when the page does not name it.
const DEFAULT_ICON = '/favicon.ico';

// One or more whitespace characters in a row, where a page's text is split and rejoined.
// Example: "Hello \n\t world" matches at " \n\t "; "Hello" has no match.
// Try it: https://regex101.com/?regex=%5Cs%2B&flags=g&flavor=javascript&testString=Hello%20%0A%09%20world
const WHITESPACE_RUN = /\s+/;

// Text cut to `max` characters, or null for nothing.
function clip(text: string | null | undefined, max: number): string | null {
  // Runs of spaces, tabs and line breaks become one space, as a browser shows them.
  const tidy = text?.split(WHITESPACE_RUN).join(' ').trim();
  return tidy ? tidy.slice(0, max) : null;
}

// An absolute http(s) URL for `href`, resolved against the page; null for anything else, such
// as a data: or javascript: link.
function webUrl(href: string, base: string): string | null {
  const url = URL.canParse(href, base) ? new URL(href, base) : null;
  if (url === null) return null;
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

// The preview for a page's HTML. `pageUrl` is where it was read from, for relative icon links.
export function readPreview(html: string, pageUrl: string): Preview {
  const $ = load(html);
  // The content of the first meta tag matching `selector`.
  const meta = (selector: string) => $(selector).first().attr('content');
  // og:title is what the site wants shown when the page is shared, so it beats <title>,
  // which often carries the site name as well.
  const title = clip(meta('meta[property="og:title"]') ?? $('title').first().text(), TITLE_MAX);
  // og:description first, then the classic description tag.
  const description = clip(meta('meta[property="og:description"]') ?? meta('meta[name="description"]'), DESCRIPTION_MAX);
  // rel~="icon" matches "icon" and "shortcut icon"; the Apple icon is a good second choice.
  const iconHref =
    $('link[rel~="icon"]').first().attr('href') ?? $('link[rel="apple-touch-icon"]').first().attr('href') ?? DEFAULT_ICON;
  // Only stored and shown by the browser; the server never fetches it.
  return { title, description, iconUrl: webUrl(iconHref, pageUrl) };
}
