# AAGeek Events

A single-file, client-side events calendar that pulls events from a public Google Calendar feed and lets users **filter** them by class, category, venue, and day-of-week — without any server.

The whole app is one `index.html` (~110 KB). Drop it on GitHub Pages, Netlify, Cloudflare Pages, S3, or any static host. No build step.

---

## How the filtering works (the important part)

Google Calendar gives you an event title, a start/end time, a location, and a description — but **no structured way** to tag events with custom labels like "this is a Speaker meeting" or "this is virtual."

The trick this app uses: **the first line of every event's description carries the tags**, in a fixed format:

```
<Class>|<Category>|<Venue>
```

That single tag-line is followed by `<br><br>--<br>` (a visual divider used by Google Calendar's rich text editor) and then the human-readable event description. Example:

```
AAGeek|Speaker|Virtual<br><br>--<br>
As Bill Sees It<br>
George H — Nobleton, ON (CA) & Harold L — St Louis, MO<br>
ID: 82694310797  PW: 124145<br>
https://us06web.zoom.us/j/82694310797?pwd=...
```

When you create or edit an event in Google Calendar, **the first line of the Description must be exactly the three pipe-separated tags**. The rest of the description is whatever you'd normally write.

### The tag vocabulary

| Dimension | Allowed values |
|---|---|
| **Class** | `AAGeek` · `NETA65` · `AAWSNY` |
| **Category** | `Study` · `Seminar` · `Speaker` · `Series` · `Story` · `Service` · `Session` |
| **Venue** | `Virtual` · `Physical` · `Hybrid` |

Tags are **case-insensitive** in the parser, but please write them in the canonical form above so the calendar stays consistent. Order doesn't matter — `Virtual|AAGeek|Speaker` is parsed identically to `AAGeek|Speaker|Virtual`.

### What the parser does, step by step

1. **Fetches the public ICS feed** from Google (URL is in `ICS_URL` near the top of the `<script>` block).
2. **Parses with [ical.js](https://github.com/kewisch/ical.js)** which handles the full iCalendar spec — line folding, escape sequences, recurring events (`RRULE`), exception dates (`EXDATE`), recurrence overrides (`RECURRENCE-ID`), and time zones (`TZID`).
3. **For each event**, takes the `description` property — which Google delivers as **HTML** (`<br>`, `<a href>`, entities like `&amp;` and `&#39;`).
4. **Splits the description at the first `<br>`, `</p>`, or newline** to isolate the tag-line.
5. **HTML-decodes** that segment (so `&amp;` becomes `&`), then splits on `|` and trims each piece.
6. For each piece, **case-insensitive matches it against the three tag vocabularies above**. The first piece that matches the Class list becomes the event's class; same for category and venue. Pieces that don't match are ignored.
7. **Strips the tag-line + `--` separator** from the description body so users see clean text in the event details dialog.
8. **Sanitizes the remaining HTML** through a manual allow-list (`<br>`, `<a>`, `<p>`, `<strong>`, `<em>`, `<ul>`/`<ol>`/`<li>`, etc.) and validates link schemes (only `http`, `https`, `mailto`, `tel`, `zoommtg`, `zoomus`, `webcal` are allowed — everything else gets unwrapped, preventing `javascript:` injection).
9. Stores both the **sanitized HTML** (for the event dialog) and a **plain-text** version (for card previews and search) on the event object.

If an event's first line **doesn't** include `|`, or doesn't match any known tag, that event simply ends up with no tags — it'll show up under "All" filters but disappear from any specific filter.

---

## Features

- **Three views** — List · Calendar · Embedded Google Calendar
- **Calendar has two modes** — Month (grid with multi-day event bars) and Week (7-column day list)
- **Four filter dimensions** — Class, Category, Venue, Day of week — each with a live event-count badge per chip
- **Full-text search** with highlighted matches in titles and snippets
- **Pagination** — 10 / 20 / 30 / 50 / 100 / All events per page
- **Time zone** — defaults to the user's local TZ (auto-detected). Settings dialog offers toggle to America/Chicago (the calendar's published TZ).
- **Per-event .ics download** — copy any event into your own calendar app
- **"Add to my Google Calendar"** button
- **Browser-notification reminders** with a configurable lead time (5 min / 15 min / 30 min / 1 hr / 1 day)
- **Recurring event badge** with rule summary ("Every Thursday", "Monthly · third Tuesday")
- **All preferences persist** in `localStorage` — opens to the user's preferred view on next load
- **Keyboard shortcuts** for everything (press `?` to see them)
- **Print stylesheet** — clean print-out of the filtered list
- **Dark mode** auto-adapts via `prefers-color-scheme`
- **Mobile-first** responsive design

### Keyboard shortcuts

| Key | Action |
|---|---|
| `/` | Focus search |
| `Esc` | Close dialog · clear search when focused |
| `1` `2` `3` | Switch to List · Calendar · Google view |
| `←` `→` | Previous / next month (Calendar view) |
| `T` | Jump to today (Calendar view) |
| `W` | Toggle Month / Week (Calendar view) |
| `R` | Reset filters |
| `U` | Toggle "Upcoming only" |
| `P` | Print the filtered list |
| `,` | Open Settings |
| `?` | Show keyboard help |
| `Enter` / `Space` | Open an event (when card is focused) |

---

## Architecture

Everything lives in **one file**, [`index.html`](index.html):

- `<style>` — custom CSS layer on top of Pico.css (~600 lines)
- `<body>` — semantic HTML for header, filter chips, three views, three dialogs (settings / help / event details)
- `<script>` — the entire app logic in an IIFE (~1800 lines)

The only external dependencies are two CDN-loaded libraries:

| Library | Purpose | License |
|---|---|---|
| [Pico.css v2](https://picocss.com) | Base typography, forms, dark mode, dialog styling | MIT |
| [ical.js v1.5](https://github.com/kewisch/ical.js) | Robust ICS parsing including recurrence and time zones | MPL-2.0 |

### How the app gets the ICS data (CORS)

Google's public `basic.ics` endpoint sometimes — but not always — sets CORS headers. The app tries four fetch strategies in order, each with a 12-second timeout:

1. **Direct fetch** to Google
2. **`corsproxy.io`**
3. **`api.allorigins.win/raw`**
4. **`api.codetabs.com/v1/proxy`**

The first one that returns a body starting with `BEGIN:VCALENDAR` wins. The response is cached in `localStorage` (key: `aageek_calendar_cache_v1`) so subsequent loads paint instantly while a fresh fetch happens in the background.

If all four strategies fail and there's no cached data, the user gets a status banner with a link to switch to the Google embed tab, which always works.

### How recurring events are expanded

`ical.js` provides an iterator for `RRULE` events. The app:

1. Builds a UID-keyed map of override events (entries with `RECURRENCE-ID`)
2. Attaches each override to its parent via `relateException()` so the iterator returns the overridden occurrence when it hits that date
3. Expands each recurring series up to 600 occurrences within a window of −1 year to +2 years from "now"
4. `EXDATE` cancellations are honored natively by `ical.js`

Each expanded occurrence becomes a full event object in `state.events`, sortable by start time.

### State management

Two `localStorage` keys:

| Key | Contents |
|---|---|
| `aageek_calendar_cache_v1` | `{ ts: <ms>, text: <raw ICS> }` — last successful fetch |
| `aageek_prefs_v2` | All user preferences: view, calendar mode, page size, current page, time zone (and whether they picked it explicitly), notification settings, all filter values |

Preferences load via a **whitelist merge** — old/partial payloads upgrade cleanly; unknown fields are ignored.

---

## Setup

### Use as-is with my calendar

Just open `index.html` in a browser, or host it. It already points to a specific public Google Calendar.

### Point it at your own calendar

1. **Make your Google Calendar public.**
   In Google Calendar → click the three dots next to your calendar → "Settings and sharing" → enable **"Make available to public"** → in "Integrate calendar", copy the **Public address in iCal format** (it ends in `/public/basic.ics`) and the **Calendar ID** (`...@group.calendar.google.com`).

2. **In `index.html`**, find these three constants near the top of the `<script>` block:

   ```js
   const ICS_URL = 'https://calendar.google.com/calendar/ical/.../public/basic.ics';
   const CALENDAR_ID = '...@group.calendar.google.com';
   const GCAL_HTML_URL = 'https://calendar.google.com/calendar/embed?...';
   ```

   Replace all three with your own values.

3. **Update the embedded iframe** (also in the HTML body, search for `<iframe id="gcal-iframe">`) — replace its `src` with the **embed URL** you get from "Integrate calendar" → "Embed code" in Google Calendar settings.

4. **(Optional) Change the tag vocabulary.** If your community uses different classes, categories, or venues, edit the `KNOWN` constant in the `<script>` block:

   ```js
   const KNOWN = {
     class:    ['AAGeek', 'NETA65', 'AAWSNY'],
     category: ['Study', 'Seminar', 'Speaker', 'Series', 'Story', 'Service', 'Session'],
     venue:    ['Virtual', 'Physical', 'Hybrid'],
   };
   ```

   Then update the chip buttons in the filter section of the HTML to match. The class-color CSS variables (`--color-aageek` etc.) can also be customized in the `:root` block of the inline `<style>`.

### Deploy to GitHub Pages

```bash
git init
git add index.html README.md
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then in the GitHub repo settings → Pages → Source → `main` branch / root. Your calendar will be live at `https://<you>.github.io/<repo>/`.

### Deploy anywhere else

Drag `index.html` into Netlify, Cloudflare Pages, Vercel, an S3 bucket, or any plain static host. There's nothing to build.

---

## Maintenance: how to add an event

In Google Calendar, create your event normally, then **make sure the very first line of the Description field is `<Class>|<Category>|<Venue>`** with no other text before it.

Hit Save. The app's cache TTL is "next fetch" — within a few seconds of refreshing the page (or clicking the ↻ Refresh button), the new event will appear and be properly filterable.

Tip: if you have many events that share the same body, use Google Calendar's "Duplicate event" feature — it copies the description including the tag-line.

---

## Limitations

- **Reminders fire only while the tab is open.** True background notifications would need a service worker, which would compromise the single-file SPA design.
- **CORS proxies are third-party.** If Google ever consistently sets CORS headers on `basic.ics`, direct fetch will be used and proxies won't be needed.
- **Time-zone abbreviation may show as `GMT±offset`** for zones without a short name (e.g. India shows `GMT+5:30` rather than `IST`). The displayed time is correct; only the label varies.
- **Browsers without `<dialog>` support** (Safari < 15.4, Chrome < 37, Firefox < 98) will degrade — the dialogs fall back to a visible `open` attribute but without the focus-trap. All currently-shipping browsers support it natively.

---

## Browser compatibility

Modern evergreen browsers — Chrome / Edge / Firefox / Safari (latest two versions). Tested on iOS Safari and Android Chrome.

Uses these reasonably-modern features:

- `<dialog>` element with `showModal()`
- `Intl.DateTimeFormat` with `timeZone` and `timeZoneName` options
- `URL` / `URLSearchParams`
- `fetch` + `AbortController`
- `Notification` API (gracefully detected — degrades cleanly if absent)
- `Blob` / `URL.createObjectURL` (for .ics download)
- CSS `position: sticky`, `display: grid`, custom properties, `prefers-color-scheme`

---

## Security notes

This is a static site that loads HTML from a third-party source (Google Calendar) and renders it. To prevent XSS:

- All user-visible text from the calendar (title, location, plain-text body, etc.) is set via `textContent` or escaped via an `escapeHtml` helper before any `innerHTML` write.
- Event descriptions are parsed via `DOMParser` (which renders nothing on its own) and walked through an **allow-list sanitizer** that drops everything but a small set of structural and inline tags.
- All `<a href>` URLs are validated against an allow-list of safe schemes (`http`, `https`, `mailto`, `tel`, `zoommtg`, `zoomus`, `webcal`) — `javascript:`, `data:`, and `file:` are rejected.
- Google's `www.google.com/url?q=…` redirector wrapping is unwrapped so links go directly to their destination.
- `<a>` tags with no `href` (Google sometimes emits these) auto-derive the URL from their text content if it parses as a usable address.
- All outbound links set `target="_blank" rel="noopener noreferrer"`.

---

## License

MIT for the application code in this repository. The CDN libraries keep their own licenses (Pico.css: MIT, ical.js: MPL-2.0). Calendar data © its respective Google Calendar owner.

---

## Credits

- **[Pico.css](https://picocss.com)** by Lucas Larroche — clean, classless CSS framework
- **[ical.js](https://github.com/kewisch/ical.js)** by Philipp Kewisch — battle-tested iCalendar parsing in pure JavaScript
- **Pico.css and ical.js are loaded from [jsDelivr](https://www.jsdelivr.com/)**, a free open-source CDN
