# Sponsor Logic Overview

This document explains how the sponsor feature works in the app, focusing only on behavior and logic. It does not include code or implementation details.

## What The Sponsor System Does

The sponsor system displays sponsor cards and sponsor details to users when a sponsor is eligible to be shown for the selected trust and date. It also supports admin-side sponsor management.

The system uses two related data sources:

1. `sponsor_flash` decides whether a sponsor should appear.
2. `sponsors` stores the sponsor content that is shown to the user.

## Source Of Truth

The visibility of a sponsor is controlled by `sponsor_flash`, not by `sponsors`.

A sponsor is shown only when all of these are true:

1. The sponsor flash entry belongs to the currently selected trust.
2. The flash entry status is active.
3. The current date falls within the flash entry's date window.
4. The linked sponsor record exists in the sponsors table.

If any of these conditions fail, the sponsor is hidden from the public UI.

## Status Logic

Sponsor visibility depends on flash status.

- `active` means the sponsor may be shown.
- `paused` means the sponsor must not be shown.
- `inactive` means the sponsor must not be shown.

The status check happens before the date check. That means a sponsor with valid dates is still hidden if its status is not active.

## Date Logic

The sponsor system keeps the start and end date rules unchanged.

A sponsor flash entry is valid only when:

- the start date is missing or is on or before today
- the end date is missing or is on or after today

This means:

- open-ended campaigns are allowed
- future campaigns stay hidden until their start date arrives
- expired campaigns are hidden after their end date passes

## Trust Scoping

Sponsors are shown only for the selected trust.

The system first resolves the current trust, then fetches sponsor flash entries for that trust only. This prevents sponsors from other trusts from appearing in the wrong place.

## Public Sponsor Feed

The public feed is the main path that powers the sponsor section on the home screen and the sponsor list screen.

Its behavior is:

1. Load all flash entries for the selected trust.
2. Remove entries that are not active.
3. Remove entries that are outside the valid date window.
4. Keep the remaining sponsor IDs in the order they were found.
5. Load sponsor details from the sponsors table for those IDs.
6. Combine the flash metadata with the sponsor details for display.

If there are no valid sponsor flash entries, the UI shows an empty state or loading state depending on whether data is still being fetched.

## Sponsor Cards In The UI

The home screen sponsor area can show sponsors in a rotating card view.

Behavior:

- A sponsor card is only rendered from the eligible sponsor set.
- One card is considered active at a time in the carousel.
- The active card advances automatically over time.
- Touch interaction can move forward or backward on mobile.
- If only one sponsor is available, the carousel behaves as a single-card view.

## Sponsor List Screen

The sponsor list screen shows the full set of eligible sponsors for the selected trust.

Behavior:

- It opens using the currently cached sponsor order if available.
- It refreshes in the background to fetch the latest eligible sponsor set.
- It only shows sponsors that passed the flash status and date checks.
- It keeps the list aligned with the selected trust.

## Sponsor Details Screen

When a sponsor is opened, the app shows the sponsor detail view.

Behavior:

- The selected sponsor is identified by sponsor ID.
- The app loads the sponsor's content from the cached data or by fetching it again.
- If the sponsor is no longer eligible for the current trust/date, the detail request should not resolve as a visible public sponsor.

## Admin Sponsor Management

Admins can create, update, view, and delete sponsor records.

Behavior:

- Add sponsor: creates a new sponsor record.
- Update sponsor: changes sponsor content or activation fields.
- Delete sponsor: removes the sponsor from the system.
- View all sponsors: shows both active and inactive sponsors for admin review.

Admin updates that affect sponsors or sponsor flash entries should invalidate cached sponsor data so the public UI does not continue to show stale information.

## Cache And Freshness

The sponsor system uses caching to make the UI faster.

There are two main cache layers:

1. Backend in-memory cache for sponsor feed responses.
2. Frontend local cache for sponsor lists and carousel state.

Why this matters:

- Cached data can briefly show an older sponsor set.
- A cache refresh is needed after status changes or sponsor flash changes.
- Changing the storage version forces the frontend to ignore older local sponsor cache data.

## Why Paused Or Inactive Sponsors Can Appear Temporarily

If a paused or inactive sponsor still appears, it is usually because of one of these reasons:

1. An older cached sponsor list is still being shown in the UI.
2. The backend cache has not expired yet.
3. The server has not reloaded the latest logic.
4. Another valid active flash row exists for the same sponsor.

The correct final behavior is still the same: only active and date-valid sponsor flash entries should appear.

## Expected Final Behavior

The user should see:

- only sponsors linked to the selected trust
- only sponsors with active flash status
- only sponsors whose dates are currently valid
- sponsor cards, list items, and details that stay consistent across views

The admin should be able to manage sponsors independently without changing the visibility rules for the public UI.

## Summary

The sponsor feature is governed by a simple rule:

1. Trust must match.
2. Sponsor flash status must be active.
3. Date window must be valid.
4. Sponsor details are then shown from the sponsors table.

This keeps sponsor visibility predictable while allowing the content itself to remain separate from the scheduling and activation logic.
