import { getMemberTypes, getAllHospitals, getAllElectedMembers, getAllCommitteeMembers, getMembersPage } from './api';

const CACHE_KEY = 'directory_data_cache';
const CACHE_TIMESTAMP_KEY = 'directory_cache_timestamp';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

const buildCacheKey = (trustId) =>
  trustId ? `${CACHE_KEY}_${trustId}` : CACHE_KEY;
const buildTimestampKey = (trustId) =>
  trustId ? `${CACHE_TIMESTAMP_KEY}_${trustId}` : CACHE_TIMESTAMP_KEY;

export async function fetchDirectoryData(trustId = null, trustName = null) {
  try {
    console.log('Pre-loading directory data after login...');

    // Fetch first page of members (for initial display)
    const itemsPerPage = 20;
    const promises = [
      getMembersPage(1, itemsPerPage * 2, trustId, trustName),
      getAllHospitals(trustId, trustName),
      getAllElectedMembers(trustId, trustName),
      getAllCommitteeMembers(trustId, trustName),
      getMemberTypes(trustId, trustName)
    ];

    const [membersRes, hospitalsRes, electedRes, committeeRes, typesRes] = await Promise.all(promises);

    const cacheData = {
      allMembers: membersRes?.data || [],
      hospitals: hospitalsRes?.data || [],
      electedMembers: electedRes?.data || [],
      committeeMembers: committeeRes?.data || [],
      memberTypes: typesRes?.data || [],
      totalMembersCount: membersRes?.count ?? null
    };

    // Store in sessionStorage for Directory component to use
    const cacheKey = buildCacheKey(trustId || trustName);
    const tsKey = buildTimestampKey(trustId || trustName);
    sessionStorage.setItem(cacheKey, JSON.stringify(cacheData));
    sessionStorage.setItem(tsKey, Date.now().toString());

    console.log('✅ Directory data pre-loaded and cached');
    return cacheData;
  } catch (error) {
    console.error('❌ Error pre-loading directory data:', error);
    throw error;
  }
}
