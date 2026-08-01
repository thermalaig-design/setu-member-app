# Facilities Logic Overview

This document explains the facilities section in simple language. It covers the tables used, the important fields, and how the app shows facilities to the user.

## Main Tables Used

1. `facilities`
2. `Trust`
3. `auth.users`

### What each table does

- `facilities` stores the actual facility data.
- `Trust` helps the app find the correct trust when only the trust name is available.
- `auth.users` is linked through `created_by`.

## Important Fields In `facilities`

- `id` - unique facility id
- `trust_id` - tells which trust the facility belongs to
- `type` - stored category field, but it no longer hides or shows facilities
- `name` - facility name
- `description` - extra details about the facility
- `attachments` - images, PDFs, or other files linked to the facility
- `status` - shows whether the facility is active
- `created_by` - user who created the facility
- `created_at` - creation time
- `updated_at` - last update time
- `size` - extra numeric field stored with the facility

## How The Facility Workflow Works

1. The app reads the selected trust.
2. It loads facilities for that trust only.
3. It checks local cache first so the page opens faster.
4. If needed, it fetches fresh data from the server.
5. It shows the facilities list on the main page.
6. Opening a facility shows the detail page with its description and attachments.

## Attachment Features

- Images can be opened in a preview modal.
- PDFs can be shown in a preview area.
- Other document files are shown as file attachments.

## Cache And Pagination

The facilities section uses browser storage for caching.

It stores:

- facility rows by id
- the order of facilities
- page data
- detail cache
- current loading state

Pagination support is present in the data layer.

- page size is `10`
- the app loads facilities page by page
- cached pages are reused when possible

In the current UI, the app loads the first page for the list view and uses the cache to keep things fast.

## Short Summary

The facilities feature is trust-based. It uses the `facilities` table for the main data, `Trust` to resolve the trust, and `auth.users` for the creator link. The app caches data, supports paged loading in the background, and shows attachments based on file type.
