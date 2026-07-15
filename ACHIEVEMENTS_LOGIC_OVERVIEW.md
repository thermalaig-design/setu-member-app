# Achievements Logic Overview

This document explains the achievements section in simple language. It covers the tables used, the important fields, and how the achievements screen works.

## Main Tables Used

1. `achievements`
2. `Trust`

### What each table does

- `achievements` stores the main achievement records.
- `Trust` helps the app resolve the selected trust when only the trust id or name is available.

## Important Fields In `achievements`

- `id` - unique achievement id
- `trust_id` - tells which trust the achievement belongs to
- `name` - title shown on the card and detail page
- `description` - full text about the achievement
- `attachments` - images or files linked to the achievement
- `status` - only active rows are shown
- `created_at` - creation time
- `updated_at` - last update time

Note: the current achievements screen does not use `type`, `created_by`, or `size`.

## How The Workflow Works

1. The app reads the selected trust from local storage.
2. It loads only active achievements for that trust.
3. The first page shows 10 items.
4. The page stores a small cache in session storage so it can open faster next time.
5. When the user scrolls down, the next page loads automatically.
6. The newest item is shown as `Latest Highlight`.
7. The rest of the items are shown in `Achievement Trail`.
8. Clicking a card opens the achievement detail page.
9. The detail page loads the full record and shows the full description and attachments.

## Features

- Caching with `achievements_cache_v1`
- Automatic pagination with infinite scroll
- Realtime refresh when achievement data changes
- Separate detail page
- Attachment preview support
- Swipeable image preview modal in the detail page

## Short Summary

The achievements feature is trust-based. It uses the `achievements` table for the main data and `Trust` to find the selected trust. The screen shows one featured achievement, a trail list, cached pages, and automatic scroll loading, while the detail page shows the full record.
