# Theme Rollout QA

This checklist is for production-safe theme rollout after `Trust.template_id -> app_templates.id` becomes the source of truth.

## Rollout Goal

- Broken trust theme links should be caught before release
- Wrong template assignment should be visible immediately
- Runtime regressions should be caught in QA, not by end users

## Pre-Rollout Audit

Run:

```bash
cd backend
npm run theme-rollout-audit
```

Use strict mode when you want warnings to fail the rollout:

```bash
cd backend
npm run theme-rollout-audit:strict
```

What the audit checks:

- trusts missing `template_id`
- trusts pointing to missing templates
- malformed `theme_config`
- invalid `home_layout` sections
- invalid animation values
- unsafe `custom_css`
- unused templates
- multi-trust/shared template links

You can also run SQL checks manually from:

- [backend/sql/theme_rollout_checks.sql](/d:/OneDrive/Desktop/ekUdaan/ek_udaan_test/backend/sql/theme_rollout_checks.sql)

## Blocking Issues

Do not roll out if any of these are present:

- trust with `template_id = null`
- trust linked to a non-existent template
- template with malformed `theme_config`

## Warning Review

Warnings do not always block rollout, but should be reviewed:

- unused templates
- duplicate `home_layout` entries
- unsupported animation values
- custom CSS that gets sanitized away
- shared template links across multiple trusts

## Runtime QA Checklist

Test each selected trust in this flow:

1. Cold app launch
2. Trust switch from Home
3. App reload with cache already present
4. Return to app after backgrounding
5. Template updated in DB, then app refresh

Verify on each trust:

- header color matches theme
- page background updates
- quick actions update correctly
- marquee styling matches theme
- gallery card matches theme
- sponsor card matches theme
- profile page theme updates
- directory page theme updates
- footer theme updates

## Layout + Motion QA

For trusts using custom `home_layout` and `animations`, verify:

- section order matches DB order
- unknown layout entries do not break rendering
- duplicate layout entries do not render twice
- navbar animation applies
- gallery animation applies
- quick actions animation applies when configured
- sponsor section animation applies when configured

## Custom CSS QA

For templates with `custom_css`:

- styles apply only inside the app shell
- login/browser chrome outside the app is unaffected
- unsafe CSS is rejected
- media-query-based custom CSS still works

## Suggested Rollout Sequence

1. Run audit script
2. Fix blocking issues
3. Review warnings
4. QA 2-3 representative trusts
5. QA one shared/base template trust
6. QA one custom template trust
7. QA one fallback/default trust
8. Release
9. Re-run audit after template edits

## Recommended Test Trust Mix

- one base/default trust
- one trust with dedicated template
- one trust with shared/base template
- one trust with custom CSS
- one trust with custom `home_layout`

## Regression Notes

After any change to:

- `src/hooks/useTheme.js`
- `src/utils/themeUtils.js`
- `src/App.jsx`
- `src/Home.jsx`

re-run:

```bash
cd backend
npm run theme-rollout-audit
```

and repeat the runtime QA checklist above.
