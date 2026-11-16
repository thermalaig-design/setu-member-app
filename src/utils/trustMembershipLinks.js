// Reads a trust's links/version from the active-trust membership already saved in
// the stored user (hospital_memberships, filled by get_member_active_trusts_by_mobile),
// so consumers never need a separate per-trust RPC.

const clean = (value) => String(value ?? '').trim();

export const getStoredMembershipForTrust = (trustId) => {
  const id = clean(trustId);
  if (!id) return null;

  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    const memberships = Array.isArray(user?.hospital_memberships) ? user.hospital_memberships : [];
    return memberships.find((membership) => clean(membership?.trust_id) === id) || null;
  } catch {
    return null;
  }
};

// Shape getShareAppTargetLink() and the Sidebar social icons expect.
export const buildShareAppLinksFromMembership = (membership) => {
  if (!membership || typeof membership !== 'object') return null;

  const webAppUrl = clean(membership.web_app_url) || null;
  return {
    trust_id: clean(membership.trust_id) || null,
    version: membership.version ?? null,
    web_app_url: webAppUrl,
    play_store_link: webAppUrl,
    app_store_link: webAppUrl,
    instagram_link: clean(membership.instagram_link) || null,
    facebook_link: clean(membership.facebook_link) || null,
    whatsapp_link: clean(membership.whatsapp_link) || null,
    linkedin_link: clean(membership.linkedin_link) || null,
    youtube_url: clean(membership.youtube_url) || null,
  };
};
