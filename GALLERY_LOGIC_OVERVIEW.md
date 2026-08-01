# Gallery Logic Overview

This document explains how the gallery feature loads, what it checks before loading data, and which database tables and fields it uses. It stays at the workflow level and does not include code.

## What The Gallery Does

The gallery is a trust-scoped photo browsing experience. It supports:

1. Album browsing.
2. Album preview covers.
3. Page-by-page photo loading inside an album.
4. Full-screen photo viewing.
5. A compact gallery preview on the home screen.

The design goal is to stay fast while still feeling complete.

## Entry Points

The gallery is reachable from two places:

1. The home screen preview card.
2. The `/gallery` route.

The route is protected by both authentication and the `feature_gallery` feature flag. If the feature flag is disabled, the gallery entry point is hidden.

## What Is Checked Before Loading

Before the gallery loads data, it checks several things:

1. The selected trust exists.
2. The selected trust is synced into gallery state.
3. The current trust matches the cached gallery data.
4. The cache is still fresh.
5. A request for the same page is not already in flight.
6. The feature flag allows the gallery to be shown.

If the trust changes, the visible gallery state is reset and the new trust’s cache is used instead of reusing old data.

## Main Data Sources

The gallery reads from these database tables:

1. `gallery_folders`
2. `gallery_photos`

It also reads image files from Supabase Storage in the `gallery` bucket.

## Database Fields Used

### `gallery_folders`

The gallery uses these fields:

- `id`
- `name`
- `description`
- `trust_id`

### `gallery_photos`

The gallery uses these fields:

- `id`
- `storage_path`
- `public_url`
- `created_at`
- `uploaded_by`
- `folder_id`
- `trust_id`

### Storage Bucket

The `gallery` bucket is used for the actual image files. The app resolves an image URL from `public_url` first, then falls back to `storage_path`.

## Trust Scoping

Gallery data is filtered by the currently selected trust.

That means:

- folders are loaded only for the active trust
- photos are loaded only for the active trust
- cached album data is stored per trust
- switching trust clears stale visible state

This prevents one trust’s gallery content from leaking into another trust’s view.

## Loading Flow

The gallery loads in layers instead of all at once.

### 1. Provider bootstrap

When the app starts, the gallery provider reads the selected trust and tries to restore cached gallery state for that trust.

### 2. Album metadata load

The provider fetches folder metadata for the active trust. These folders become the album list.

### 3. Album previews

For each folder, the provider loads a small number of photos to build the album cover preview.

### 4. Album detail load

When a user opens an album, the app fetches that album’s photos page by page.

### 5. Photo view

When a user taps a photo, the UI opens the larger viewer/lightbox experience.

## Album Listing Workflow

The album list is the first screen inside the gallery.

Behavior:

- albums load in batches
- each album card gets a cover from preview images
- the list grows as the user scrolls
- album counts are shown when available

This makes the album list act like the front door to the photo archive.

## Album Cover Logic

Each album cover is built from preview photos:

- no preview photos: folder icon fallback
- one preview photo: single-image cover
- two preview photos: split collage

This ensures every album has a visual identity, even when the album is small.

## Album Detail Workflow

When an album is opened, the gallery switches into detail mode.

Behavior:

- the selected album is shown immediately
- page 1 can use preview images while the real page loads
- the album can be paginated
- empty albums show an empty state

This keeps the first album open feeling responsive.

## Photo Loading Workflow

Photos are loaded page by page instead of all at once.

Before a page is fetched, the gallery checks:

1. Whether that page is already cached.
2. Whether the cache timestamp is still inside the TTL window.
3. Whether a request for that page is already running.

If the page is fresh in cache, the network request is skipped.
If the page is stale, the gallery fetches it again.

## Home Screen Preview

The home screen uses gallery preview images as a quick visual signal.

Behavior:

- if preview images exist, the home card shows a slider
- if preview images do not exist, the card becomes a tap target
- the preview is trust-aware
- the preview is shown only when `feature_gallery` is enabled

## Cache Behavior

The gallery uses multiple cache layers.

### Persistent cache

Stored in `localStorage` per trust. It keeps:

- album order
- album metadata
- album pages
- album detail pages
- timestamps

### Session cache

Stored in `sessionStorage` for short-lived reuse. It keeps:

- latest gallery image sets
- folder photo batches
- temporary fetch results

### Trust-aware invalidation

When the trust changes:

- the gallery state is reset
- the new trust cache is loaded
- stale data from the previous trust is discarded

## Performance Strategy

The gallery stays fast because it avoids heavy one-shot loading.

The main strategies are:

- paginated folder loading
- paginated photo loading
- preview-first album rendering
- cache reuse when data is still fresh
- background refresh after cached display

## Upload And Admin Behavior

The gallery service also supports maintenance actions.

Behavior:

- uploads go to the `gallery` storage bucket
- photo metadata is written to `gallery_photos`
- deleting a photo removes the storage object and the DB row
- stats can be fetched for total photo counts

## UI Features

The gallery experience includes:

- album cards
- preview collages
- infinite scrolling album list
- page-based photo browsing
- full-screen photo viewing
- swipe navigation
- autoplay-style browsing
- home screen preview slider
- empty states for no albums or no photos

## Why Issues Usually Happen

When gallery content looks wrong, the usual causes are:

1. Wrong trust selected.
2. Stale local storage or session storage.
3. Folder-photo relation mismatch.
4. Missing or broken public image URLs.
5. Gallery feature flag disabled.

The first things to check are the active trust and the cache freshness.

## Expected Final Behavior

The gallery should behave like this:

1. The home card shows a gallery preview when available.
2. The gallery page lists albums for the selected trust.
3. Selecting an album shows its photos.
4. Selecting a photo opens the viewer.
5. Switching trust clears stale content and reloads the correct gallery.

## Summary

The gallery is a trust-scoped, preview-first photo browsing system. It relies on:

- `gallery_folders` for album metadata
- `gallery_photos` for photo metadata
- Supabase Storage for image files
- trust-aware caching for speed

The end result is a gallery that feels lightweight on the surface while still handling a structured photo archive underneath.
