import test from 'node:test';
import assert from 'node:assert/strict';

import { buildShareAppLinksFromMembership } from '../src/utils/trustMembershipLinks.js';
import { getShareAppTargetLink } from '../src/utils/shareApp.js';

test('membership links map into the share-app shape, with web_app_url as the store links', () => {
  const links = buildShareAppLinksFromMembership({
    trust_id: 't1',
    version: 7,
    web_app_url: ' https://app.example.com/t1 ',
    instagram_link: 'https://instagram.com/t1',
    youtube_url: 'https://youtube.com/t1',
  });

  assert.equal(links.version, 7);
  assert.equal(links.web_app_url, 'https://app.example.com/t1');
  assert.equal(links.play_store_link, links.web_app_url);
  assert.equal(links.app_store_link, links.web_app_url);
  assert.equal(links.instagram_link, 'https://instagram.com/t1');
  assert.equal(links.facebook_link, null);
  assert.equal(getShareAppTargetLink(links, 'ios', ''), 'https://app.example.com/t1');
});

test('missing membership or links never throw and yield no target link', () => {
  assert.equal(buildShareAppLinksFromMembership(null), null);
  assert.equal(buildShareAppLinksFromMembership(undefined), null);

  const links = buildShareAppLinksFromMembership({ trust_id: 't2' });
  assert.equal(links.version, null);
  assert.equal(links.web_app_url, null);
  assert.equal(getShareAppTargetLink(links, 'android', ''), '');
});
