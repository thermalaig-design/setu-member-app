# Events Logic Overview

This document explains the events section in simple language. It covers the tables used, the important fields, and how the app shows events to the user.

## Main Tables Used

1. `events`
2. `Trust`
3. `auth.users`

### What each table does

- `events` stores the actual event data.
- `Trust` links an event to the selected trust.
- `auth.users` is used for the `created_by` relation.

The app also uses a trigger called `trg_event_dashboard_sync` so dashboard data stays updated when events change.

## Important Fields In `events`

- `id` - unique event id
- `trust_id` - tells which trust the event belongs to
- `type` - event type, such as general
- `title` - event name
- `description` - extra details about the event
- `attachments` - files, images, or documents linked to the event
- `location` - where the event happens
- `startEventDate` - starting date of the event
- `endEventDate` - ending date of the event
- `startTime` - start time
- `endTime` - end time
- `status` - stored status in the table
- `created_by` - user who created the event
- `created_at` - creation time
- `updated_at` - last update time
- `size` - extra numeric field stored with the event

## How The Event Workflow Works

1. The app first reads the selected trust.
2. It loads events only for that trust.
3. It checks local cache first so the list opens faster.
4. It fetches fresh data if needed.
5. It splits events into `current`, `upcoming`, and `past`.
6. It shows the events in the list with pagination.
7. Opening an event shows the event detail page and its attachments.

## How Event Status Is Decided

The visible event category is not based only on the `status` column.

The app mainly uses:

- `startEventDate`
- `endEventDate`
- `startTime`
- `endTime`

Simple rule:

- if the end date has passed, the event is `past`
- if the start date is in the future, the event is `upcoming`
- if today is inside the date range, the event is `current`
- if the event ends today and the end time has passed, it becomes `past`

## Attachment Features

The app handles attachments in a few ways:

- images can be opened in a preview modal
- PDF files can be opened in a preview modal and downloaded
- other documents can be downloaded

## Cache And Pagination

The events screen uses browser storage to cache data per trust.

It stores:

- all events for the trust
- event order
- paged results
- detail cache

Pagination is present as a `Load more` flow.

- page size is `10`
- the app loads the next page when the user taps `Load more events`
- cached pages are reused when possible

## Short Summary

The events feature is a trust-based event system. It uses the `events` table for data, `Trust` for trust linking, and `auth.users` for creator info. The app filters, sorts, caches, and pages events on the client side, and attachments can be previewed or downloaded depending on file type.
