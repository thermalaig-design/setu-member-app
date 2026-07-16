// Shared helpers for matching a directory/executive-body row against the
// currently logged-in member, used to live-patch privacy state without a
// full refetch (see Sidebar's privacy toggle).

export const MEMBER_PRIVACY_UPDATED_EVENT = 'member-privacy-updated';

const normalizeIdentityValue = (value) => String(value ?? '').trim();

export const matchesMemberIdentity = (item = {}, target = {}) => {
  const targetId = normalizeIdentityValue(target?.membersId);
  const targetMobile = normalizeIdentityValue(target?.mobile);
  const targetMembership = normalizeIdentityValue(target?.membershipNumber);
  if (!targetId && !targetMobile && !targetMembership) return false;

  const rowId = normalizeIdentityValue(item?.members_id);
  const rowMobile = normalizeIdentityValue(item?.Mobile);
  const rowMembership = normalizeIdentityValue(
    item?.['Membership number'] ?? item?.membership_number ?? item?.membership_no
  );

  return (
    (Boolean(targetId) && targetId === rowId) ||
    (Boolean(targetMobile) && targetMobile === rowMobile) ||
    (Boolean(targetMembership) && targetMembership === rowMembership)
  );
};
