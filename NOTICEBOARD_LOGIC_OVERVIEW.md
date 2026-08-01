# Notice Board Logic Overview

This document explains how the notice board works in the app, using plain workflow language. It covers the tables used, the checks performed before data is shown, and the important database fields involved.

## What The Notice Board Does

The notice board shows trust-specific announcements to the user.

It supports:

- notice list browsing
- notice detail viewing
- attachment previews
- image, PDF, and file handling
- cached loading for faster repeat visits

## Main Data Sources

The notice board reads from these database tables:

1. `noticeboard`
2. `Trust`

It also uses browser storage for selected trust and cached noticeboard data.

## Important Database Fields

### `noticeboard`

These are the main fields used by the app:

- `id`
- `trust_id`
- `type`
- `name`
- `description`
- `attachments`
- `start_date`
- `end_date`
- `status`
- `created_at`
- `updated_at`

### `Trust`

This table is used only to resolve a trust id when the app has a trust name but not a direct id.

The main field used is:

- `id`

## What The App Checks Before Showing Notices

Before notices are shown, the app checks:

1. A valid trust can be resolved.
2. The notice belongs to the selected trust.
3. The notice `status` is active-like.
4. The notice date range is valid for today.
5. The attachment data can be turned into a usable URL.

### Active-like status values

The app accepts these values as active:

- `active`
- `1`
- `true`
- `enabled`
- `published`

### Date check

The app keeps the date logic separate from status logic.

The notice is shown when:

- `start_date` is missing or today is on/after it
- `end_date` is missing or today is on/before it

## Trust Scoping

The notice board is trust-scoped.

That means:

- only notices from the selected trust are loaded
- switching trust changes the visible noticeboard data
- cached data is stored per trust and member context

## Loading Workflow

### 1. Resolve trust

The app first looks for the active trust id.

If no trust id exists, it tries to resolve one from the trust name.

### 2. Load cached notices

If cached notice data exists for the same trust context, the app shows that first.

### 3. Fetch the notice list

The app fetches rows from `noticeboard`, then filters them by:

- trust match
- active-like status
- today’s date validity

### 4. Build notice cards

Each notice card shows:

- title
- description
- date range
- one attachment preview when available

### 5. Open notice detail

When a notice is opened, the app loads the same trust-scoped notice detail and keeps the attachments and dates intact.

## Sorting Behavior

The notice list is sorted by timeline:

- live notices first
- upcoming notices next
- past notices after that
- notices with no dates last

Within the same bucket, the app prefers newer notices first.

## Attachment Workflow

Attachments are normalized before rendering.

The app accepts attachment values that can be resolved into:

- a valid `http(s)` URL
- a valid `data:` URL

Attachment types are handled as:

- image: shown as a preview card and openable in detail
- PDF: shown as a PDF preview in detail
- other files: shown as a generic file attachment

## Cache Behavior

The notice board stores cache in browser local storage.

Cache is used for:

- notice order
- notice rows by id
- paged results
- notice detail data
- loading state

The cache is scoped to the current trust and member context so one trust’s notices do not overwrite another trust’s data.

## What No Longer Controls Visibility

Notice visibility is no longer decided by any VIP or general user split.

For the notice board, the only deciding factors are:

- trust match
- active status
- date validity

The `type` field is still stored and returned, but it is treated as notice metadata rather than a visibility rule.

## User-Facing Result

The notice board should feel like this:

- all valid notices appear in one list
- notices are filtered by trust, status, and date only
- attachments remain available
- notice detail still works with drag/swipe and previews
- cache keeps repeat loading fast

## Summary

The notice board is a trust-scoped announcement system. Its working logic is centered on:

- `noticeboard` for content
- `Trust` for trust resolution
- active status checks
- date validity checks
- attachment normalization
- trust-scoped cache

That keeps the notice board simple, predictable, and easy to maintain.
