import test from 'node:test';
import assert from 'node:assert/strict';
import { getShareAppTargetLink } from '../src/utils/shareApp.js';

test('prefers the iOS link when the platform is iOS', () => {
  const targetLink = getShareAppTargetLink(
    { play_store_link: 'https://play.google.com/store', app_store_link: 'https://apps.apple.com/app' },
    'ios'
  );

  assert.equal(targetLink, 'https://apps.apple.com/app');
});

test('falls back to the Android link when no iOS link is present', () => {
  const targetLink = getShareAppTargetLink(
    { play_store_link: 'https://play.google.com/store', app_store_link: '' },
    'android'
  );

  assert.equal(targetLink, 'https://play.google.com/store');
});

test('uses the fallback link when no trust-specific links are available', () => {
  const targetLink = getShareAppTargetLink(
    { play_store_link: '', app_store_link: '' },
    'android',
    'https://teiltd.in/app-download'
  );

  assert.equal(targetLink, 'https://teiltd.in/app-download');
});
