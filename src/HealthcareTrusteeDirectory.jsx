import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { User, Users, Stethoscope, Building2, Star, ChevronRight, ChevronLeft, Menu, X, Home as HomeIcon, Clock, FileText, UserPlus, Phone, Mail, MapPin, Search, Filter, ArrowLeft, ArrowRight } from 'lucide-react';
import Sidebar from './components/Sidebar';
import { getAllCommitteeMembers, getAllDoctors, getAllElectedMembers, getProfilePhotos } from './services/api';
import { getExecutiveBodyMembers, getTrusteesAndPatrons } from './services/supabaseService';
import { registerSidebarState, useAndroidBack } from './hooks';
import { useAppTheme } from './context/ThemeContext';
import { fetchFeatureFlags, subscribeFeatureFlags, isFeatureVisible } from './services/featureFlags';
import { fetchSubFeatureFlags, subscribeSubFeatureFlags } from './services/subFeatureFlags';
import { getNavbarThemeStyles } from './utils/themeUtils';

const CACHE_KEY_HTD = 'healthcare_trustee_directory_cache';
const CACHE_TIMESTAMP_KEY_HTD = 'healthcare_trustee_directory_cache_timestamp';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const MAX_ORDER_VALUE = Number.MAX_SAFE_INTEGER;

const getMembershipValue = (member) =>
  member?.membership_number ??
  member?.['Membership number'] ??
  member?.membership_number_elected ??
  member?.member_id ??
  member?.['S. No.'] ??
  member?.id ??
  '';

const getMembershipSortMeta = (member) => {
  const text = String(getMembershipValue(member) || '').trim();
  if (!text) return { hasMembership: false, numericPart: MAX_ORDER_VALUE, textPart: '' };

  const numericMatch = text.match(/\d+/g);
  const numericPart = numericMatch
    ? Number.parseInt(numericMatch.join(''), 10)
    : MAX_ORDER_VALUE;

  return { hasMembership: true, numericPart, textPart: text.toLowerCase() };
};

const getPrioritySortMeta = (member) => {
  const rawPriority = String(member?.priority ?? '').trim();
  if (!rawPriority) return { hasPriority: false, numericPart: MAX_ORDER_VALUE };

  const numericPart = Number(rawPriority);
  if (!Number.isFinite(numericPart)) {
    return { hasPriority: false, numericPart: MAX_ORDER_VALUE };
  }

  return { hasPriority: true, numericPart };
};

const sortMembersByMembershipNumber = (members = []) => {
  return [...members].sort((a, b) => {
    const priorityA = getPrioritySortMeta(a);
    const priorityB = getPrioritySortMeta(b);

    if (priorityA.hasPriority || priorityB.hasPriority) {
      if (priorityA.hasPriority !== priorityB.hasPriority) {
        return priorityA.hasPriority ? -1 : 1;
      }
      if (priorityA.numericPart !== priorityB.numericPart) {
        return priorityA.numericPart - priorityB.numericPart;
      }
    }

    const metaA = getMembershipSortMeta(a);
    const metaB = getMembershipSortMeta(b);

    if (metaA.hasMembership !== metaB.hasMembership) {
      return metaA.hasMembership ? -1 : 1;
    }
    if (metaA.numericPart !== metaB.numericPart) {
      return metaA.numericPart - metaB.numericPart;
    }
    if (metaA.textPart !== metaB.textPart) {
      return metaA.textPart.localeCompare(metaB.textPart);
    }

    const nameA = String(a?.Name ?? a?.member_name_english ?? a?.hospital_name ?? '').toLowerCase();
    const nameB = String(b?.Name ?? b?.member_name_english ?? b?.hospital_name ?? '').toLowerCase();
    return nameA.localeCompare(nameB);
  });
};

const buildCacheKey = (trustKey) =>
  trustKey ? `${CACHE_KEY_HTD}_${trustKey}` : CACHE_KEY_HTD;
const buildTimestampKey = (trustKey) =>
  trustKey ? `${CACHE_TIMESTAMP_KEY_HTD}_${trustKey}` : CACHE_TIMESTAMP_KEY_HTD;

const DIRECTORY_ICON_MAP = {
  members: Users,
  healthcare: Stethoscope,
  committee: Users,
  doctors: Stethoscope,
  hospitals: Building2,
  elected: Star,
};

const resolveDirectoryTier = () => {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return 'gen';
    const parsed = JSON.parse(raw);
    const vipStatus = String(parsed?.vip_status || '').trim().toLowerCase();
    return vipStatus ? 'vip' : 'gen';
  } catch {
    return 'gen';
  }
};

const HealthcareTrusteeDirectory = ({ onNavigate }) => {
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedDirectory, setSelectedDirectory] = useState(null); // null, 'healthcare', 'trustee', or 'committee'
  const [activeTab, setActiveTab] = useState(null);
  const trustId = localStorage.getItem('selected_trust_id') || null;
  const trustName = localStorage.getItem('selected_trust_name') || null;
  const trustCacheKey = trustId || trustName;

  const [allMembers, setAllMembers] = useState([]);
  const [opdDoctors, setOpdDoctors] = useState([]); // doctors fetched directly from Supabase with image URLs
  const [opdDoctorsLoading, setOpdDoctorsLoading] = useState(false); // Track loading state for doctors
  const [committeeMembers, setCommitteeMembers] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [electedMembers, setElectedMembers] = useState([]);
  const [profilePhotos, setProfilePhotos] = useState({});
  const [loading, setLoading] = useState(false); // Changed to false - show page immediately
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredMembers, setFilteredMembers] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [dataLoaded, setDataLoaded] = useState(false);
  const itemsPerPage = 20;
  const { registerBackHandler } = useAndroidBack();
  const [featureFlags, setFeatureFlags] = useState({});
  const [featureMeta, setFeatureMeta] = useState({});
  const [subFeatureFlags, setSubFeatureFlags] = useState({});
  const [subFeatureMeta, setSubFeatureMeta] = useState({});

  // Ref to track previous filtered members to avoid infinite loop
  const previousFilteredRef = useRef([]);

  // Ref for the content area to scroll to
  const contentRef = useRef(null);

  const hasSubFeatureConfig = Object.keys(subFeatureFlags || {}).length > 0;
  const isSubFeatureEnabled = (key) => {
    if (!hasSubFeatureConfig) return true;
    if (!(key in subFeatureFlags)) return true;
    return subFeatureFlags[key] !== false;
  };
  const getSubFeatureMeta = useCallback((key) => subFeatureMeta?.[key] || {}, [subFeatureMeta]);
  const getSubFeatureDisplayName = useCallback((key, fallback) => getSubFeatureMeta(key)?.display_name || fallback, [getSubFeatureMeta]);
  const getSubFeatureTagline = useCallback((key, fallback = '') => getSubFeatureMeta(key)?.tagline || fallback, [getSubFeatureMeta]);
  const getSubFeatureIconUrl = useCallback((key) => getSubFeatureMeta(key)?.icon_url || null, [getSubFeatureMeta]);
  const getFeatureMeta = (key) => featureMeta?.[key] || {};
  const getFeatureDisplayName = (key, fallback) => getFeatureMeta(key)?.display_name || fallback;
  const getSubFeatureOrder = (key, fallback = 9999) => {
    const value = getSubFeatureMeta(key)?.quick_order;
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const isDirectoryEnabled = isFeatureVisible(featureFlags, 'feature_directory');
  const isCommitteeEnabled = isFeatureVisible(featureFlags, 'feature_committee');
  const isElectedEnabled = isFeatureVisible(featureFlags, 'feature_elected_members');

  const isMembersTabEnabled = hasSubFeatureConfig ? isSubFeatureEnabled('members') : true;
  const isDoctorsTabEnabled = hasSubFeatureConfig
    ? (isSubFeatureEnabled('doctors') || isSubFeatureEnabled('healthcare'))
    : true;
  const isElectedTabEnabled = hasSubFeatureConfig ? isSubFeatureEnabled('elected') : isElectedEnabled;
  const isCommitteeTabEnabled = hasSubFeatureConfig ? isSubFeatureEnabled('committee') : isCommitteeEnabled;
  const isHealthcareEnabled = isDoctorsTabEnabled;

  const canShowTrustee = isDirectoryEnabled && isMembersTabEnabled;
  const canShowHealthcare = isDirectoryEnabled && isHealthcareEnabled;
  const canShowCommittee = isDirectoryEnabled && (hasSubFeatureConfig ? (isSubFeatureEnabled('committee') && (isCommitteeTabEnabled || isElectedTabEnabled)) : (isCommitteeEnabled || isElectedEnabled));

  useEffect(() => {
    const loadFlags = async (force = false) => {
      const trustId = localStorage.getItem('selected_trust_id') || null;
      const result = await fetchFeatureFlags(trustId, { force });
      if (result.success) {
        setFeatureFlags(result.flags || {});
        setFeatureMeta(result.flagsData || {});
      }
    };
    loadFlags();

    const handleFocus = () => loadFlags(true);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') loadFlags(true);
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    const trustId = localStorage.getItem('selected_trust_id') || null;
    const unsubscribe = subscribeFeatureFlags(trustId, () => loadFlags(true));

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const loadSubFlags = async (force = false) => {
      const trustId = localStorage.getItem('selected_trust_id') || null;
      const tier = resolveDirectoryTier();
      const result = await fetchSubFeatureFlags(trustId, { tier, featureKey: 'feature_directory', force });
      if (result.success) {
        setSubFeatureFlags(result.flags || {});
        setSubFeatureMeta(result.meta || {});
      }
    };
    loadSubFlags();

    const handleFocus = () => loadSubFlags(true);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') loadSubFlags(true);
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    const trustId = localStorage.getItem('selected_trust_id') || null;
    const unsubscribe = subscribeSubFeatureFlags(trustId, () => loadSubFlags(true));

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribe?.();
    };
  }, []);

  // Scroll locking when sidebar is open
  useEffect(() => {
    if (isMenuOpen) {
      const scrollY = window.scrollY;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.touchAction = 'none';
    } else {
      const scrollY = parseInt(document.body.style.top || '0') * -1;
      document.documentElement.style.overflow = 'unset';
      document.body.style.overflow = 'unset';
      document.body.style.position = 'unset';
      document.body.style.width = 'unset';
      document.body.style.top = 'unset';
      document.body.style.touchAction = 'auto';
      window.scrollTo(0, scrollY);
    }
    return () => {
      document.documentElement.style.overflow = 'unset';
      document.body.style.overflow = 'unset';
      document.body.style.position = 'unset';
      document.body.style.width = 'unset';
      document.body.style.top = 'unset';
      document.body.style.touchAction = 'auto';
    };
  }, [isMenuOpen]);

  // Register sidebar state so Android hardware back closes sidebar first.
  useEffect(() => {
    registerSidebarState(isMenuOpen, () => setIsMenuOpen(false));
  }, [isMenuOpen]);

  // Handle Android hardware back inside directory flow before leaving route.
  useEffect(() => {
    if (!isMenuOpen && !selectedDirectory) return undefined;

    const unregister = registerBackHandler(() => {
      if (isMenuOpen) {
        setIsMenuOpen(false);
        return;
      }

      if (selectedDirectory) {
        setSelectedDirectory(null);
        setActiveTab(null);
        setSearchQuery('');
      }
    });

    return () => {
      unregister?.();
    };
  }, [isMenuOpen, selectedDirectory]);

  // Fetch all members, hospitals and member types when component mounts
  const fetchMembers = async (isBackground = false) => {
    let mounted = true;
    let hospitalsData = [];
    let committeeData = [];
    let electedData = [];

    try {
      if (!isBackground) {
        setLoading(true);
      }
      setError(null);
      console.log('Fetching trustees and patrons from Supabase...');
      const response = await getTrusteesAndPatrons(trustId, trustName);
      console.log('Trustees/patrons response:', response);

      if (!mounted) return;

      setAllMembers(response.data || []);

      // Fetch doctors from backend (reg_members where role contains "doctor")
      try {
        setOpdDoctorsLoading(true); // Set loading flag before fetching
        console.log('Fetching doctors from reg_members with:', { trustId, trustName });
        const opdResponse = await getAllDoctors(trustId, trustName);
        console.log('Doctors response:', opdResponse);
        if (opdResponse.success && Array.isArray(opdResponse.data)) {
          console.log('Setting OPD doctors, count:', opdResponse.data.length);
          setOpdDoctors(opdResponse.data || []);
          console.log('Doctors fetched successfully:', opdResponse.data);
        } else {
          console.warn('Doctors response invalid:', { success: opdResponse.success, isArray: Array.isArray(opdResponse.data) });
          setOpdDoctors([]);
        }
      } catch (opdErr) {
        console.error('Error fetching doctors:', opdErr);
        setOpdDoctors([]);
      } finally {
        setOpdDoctorsLoading(false); // Clear loading flag after fetching
      }

      // Healthcare should show doctors only
      hospitalsData = [];
      setHospitals([]);

      // Fetch executive body members from member_roles + reg_members + Members
      try {
        const executiveResponse = await getExecutiveBodyMembers(trustId, trustName);
        if (executiveResponse?.success) {
          committeeData = executiveResponse?.data?.committee || [];
          electedData = executiveResponse?.data?.elected || [];
          setCommitteeMembers(committeeData);
          setElectedMembers(electedData);
          console.log('Executive body response:', {
            committeeCount: committeeData.length,
            electedCount: electedData.length
          });
        } else {
          throw new Error(executiveResponse?.error || 'Executive body fetch failed');
        }
      } catch (executiveErr) {
        console.error('Error fetching executive body from member_roles, falling back to legacy tables:', executiveErr);
        try {
          const committeeResponse = await getAllCommitteeMembers(trustId, trustName);
          committeeData = committeeResponse?.data || [];
          setCommitteeMembers(committeeData);
        } catch (committeeErr) {
          console.error('Error fetching committee members:', committeeErr);
          setCommitteeMembers([]);
        }

        try {
          const electedResponse = await getAllElectedMembers(trustId, trustName);
          electedData = electedResponse?.data || [];
          setElectedMembers(electedData);
        } catch (electedErr) {
          console.error('Error fetching elected members:', electedErr);
          setElectedMembers([]);
        }
      }

      setDataLoaded(true);

      // Cache the data (now including committeeMembers)
      try {
        const cacheData = {
          allMembers: response.data || [],
          hospitals: hospitalsData,
          electedMembers: electedData,
          committeeMembers: committeeData,
        };
        sessionStorage.setItem(buildCacheKey(trustCacheKey), JSON.stringify(cacheData));
        sessionStorage.setItem(buildTimestampKey(trustCacheKey), Date.now().toString());
      } catch (cacheErr) {
        console.error('Error caching data:', cacheErr);
      }
    } catch (err) {
      console.error('Error fetching members:', err);
      setError(`Failed to load members data: ${err.message || 'Please make sure backend server is running on port 5000'}`);
    } finally {
      if (mounted && !isBackground) {
        setLoading(false);
      }
    }
  };

  // Restore directory and tab when coming back from member details
  useEffect(() => {
    const restoreDirectory = sessionStorage.getItem('restoreDirectory');
    const restoreTab = sessionStorage.getItem('restoreDirectoryTab');
    if (restoreDirectory) {
      setSelectedDirectory(restoreDirectory);
      if (restoreTab) {
        setActiveTab(restoreTab);
      } else if (restoreDirectory === 'healthcare') {
        setActiveTab('doctors');
      } else if (restoreDirectory === 'committee') {
        setActiveTab('committee');
      } else if (restoreDirectory === 'trustee') {
        setActiveTab('trustees');
      }
      sessionStorage.removeItem('restoreDirectory');
      sessionStorage.removeItem('restoreDirectoryTab');
    }
  }, []);

  // Load cached data if available
  useEffect(() => {
    try {
      const cachedData = sessionStorage.getItem(buildCacheKey(trustCacheKey));
      const cacheTimestamp = sessionStorage.getItem(buildTimestampKey(trustCacheKey));

      if (cachedData && cacheTimestamp) {
        const cacheAge = Date.now() - parseInt(cacheTimestamp, 10);
        if (cacheAge < CACHE_DURATION) {
          const parsed = JSON.parse(cachedData);

          // If committeeMembers missing from old cache but allMembers exists,
          // the cache was written before committee fetch Ã¢â‚¬â€ invalidate it.
          const isStaleCache =
            (!parsed.committeeMembers || parsed.committeeMembers.length === 0) &&
            parsed.allMembers && parsed.allMembers.length > 0;

          if (!isStaleCache) {
            setAllMembers(parsed.allMembers || []);
            setHospitals(parsed.hospitals || []);
            setElectedMembers(parsed.electedMembers || []);
            setCommitteeMembers(parsed.committeeMembers || []);
            setDataLoaded(true);
            // Still fetch fresh data in background but don't block UI
            fetchMembers(true);
            return;
          }

          // Stale cache Ã¢â‚¬â€ remove it and fall through to a full fetch
          sessionStorage.removeItem(buildCacheKey(trustCacheKey));
          sessionStorage.removeItem(buildTimestampKey(trustCacheKey));
        }
      }
    } catch (err) {
      console.error('Error loading cache:', err);
    }
    // No cache, expired cache, or stale cache Ã¢â‚¬â€ fetch data fresh
    fetchMembers(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCommitteeCount = () => {
    return committeeMembers.length;
  };

  const getDoctorsCount = () => opdDoctors.length > 0 ? opdDoctors.length : allMembers.filter(m =>
    (m.type && (m.type.toLowerCase().includes('doctor') ||
      m.type.toLowerCase().includes('medical'))) ||
    m.specialization ||
    m.designation ||
    (m.consultant_name && m.department) // This indicates it's from opd_schedule
  ).length;

  const getHospitalsCount = () => hospitals.length;

  const getElectedMembersCount = () => electedMembers.length;

  const normalizeTrustRole = (member) => {
    const raw = String(
      member?.role ||
      member?.type ||
      member?.member_role ||
      member?.position ||
      member?.title ||
      member?.subtitle ||
      ''
    )
      .trim()
      .toLowerCase();
    return raw;
  };

  const governanceRoles = useMemo(() => [
    'trustee', 'trustees',
    'founder', // Ek Udaan custom role
    'president',
    'chairman',
    'vice-chairman',
    'secretary',
    'treasurer',
    'chief patron',
    'patron-in-chief',
    'advisor',
    'board member'
  ], []);

  const isTrusteeRole = useCallback((member) => {
    const role = normalizeTrustRole(member);
    if (!role) return false;
    // Check strict matches first
    if (role === 'trustee' || role === 'trustees') return true;
    // Check against governance roles list (excludes 'patron')
    return governanceRoles.includes(role);
  }, [governanceRoles]);

  const isPatronRole = useCallback((member) => {
    const role = normalizeTrustRole(member);
    // Only patron and patrons - nothing else
    return role === 'patron' || role === 'patrons';
  }, []);

  // Regular members = not a trustee, not a patron (general members like Ek Udaan members)
  const isRegularMember = useCallback((member) => {
    return !isTrusteeRole(member) && !isPatronRole(member);
  }, [isTrusteeRole, isPatronRole]);

  const combinedTrustMembers = useMemo(
    () => [...allMembers, ...electedMembers],
    [allMembers, electedMembers]
  );

  const getTrusteesCount = useCallback(() => combinedTrustMembers.filter(isTrusteeRole).length, [combinedTrustMembers, isTrusteeRole]);
  const getPatronsCount = useCallback(() => combinedTrustMembers.filter(isPatronRole).length, [combinedTrustMembers, isPatronRole]);
  const getRegularMembersCount = useCallback(() => combinedTrustMembers.filter(isRegularMember).length, [combinedTrustMembers, isRegularMember]);

  // Function to get members based on selected directory and tab
  const getMembersByDirectoryAndTab = useCallback((directory, tabId) => {
    console.log('getMembersByDirectoryAndTab called:', { directory, tabId, opdDoctorsLength: opdDoctors.length, opdDoctorsLoading, hospitalsLength: hospitals.length });
    if (directory === 'healthcare') {
      if (tabId === 'doctors') {
        // If doctors are still loading, don't show fallback - wait for real data
        if (opdDoctorsLoading) {
          console.log('OPD doctors still loading, returning empty array to show loading state');
          return [];
        }

        // Prefer opdDoctors (direct Supabase fetch with proper image URLs)
        if (opdDoctors.length > 0) {
          console.log('Returning opdDoctors:', opdDoctors);
          return opdDoctors;
        }
        // Fallback to allMembers only if not loading and opdDoctors came back empty
        const fallbackDoctors = allMembers.filter(member =>
          (member.type && (
            member.type.toLowerCase().includes('doctor') ||
            member.type.toLowerCase().includes('medical')
          )) || member.specialization || member.designation || (member.consultant_name && member.department)
        );
        console.log('Fallback doctors from allMembers:', fallbackDoctors);
        return fallbackDoctors;
      }
    } else if (directory === 'trustee') {
      const combineMembers = combinedTrustMembers;

      if (tabId === 'trustees') {
        return combineMembers.filter((member) => isTrusteeRole(member));
      }

      if (tabId === 'patrons') {
        return combineMembers.filter((member) => isPatronRole(member));
      }

      if (tabId === 'members') {
        // Show all non-governance, non-patron members (general members)
        return combineMembers.filter((member) => isRegularMember(member));
      }
    } else if (directory === 'committee') {
      if (tabId === 'elected') {
        // Return elected members from member_roles(role_type='elected')
        return electedMembers;
      } else {
        // Return committee members from member_roles(role_type='committee')
        return committeeMembers;
      }
    }
    return [];
  }, [allMembers, combinedTrustMembers, opdDoctors, opdDoctorsLoading, hospitals, electedMembers, committeeMembers, isTrusteeRole, isPatronRole, isRegularMember]);

  // Healthcare Directory Tabs Ã¢â‚¬â€ memoized to keep referential stability
  const healthcareTabs = useMemo(() => {
    const tabs = [
      {
        id: 'doctors',
        label: `${getSubFeatureDisplayName('doctors', 'Doctors')} (${getDoctorsCount()})`,
        icon: Stethoscope,
        icon_url: getSubFeatureIconUrl('doctors'),
        enabled: isDirectoryEnabled && isDoctorsTabEnabled
      },
    ];
    const filtered = tabs.filter((t) => t.enabled);
    filtered.sort((a, b) => getSubFeatureOrder(a.id) - getSubFeatureOrder(b.id));
    return filtered;
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allMembers, opdDoctors, hospitals, isDirectoryEnabled, isDoctorsTabEnabled, subFeatureMeta]);

  // Trustee Directory Tabs Ã¢â‚¬â€ memoized
  const getTrusteeTabLabel = (tabId, count) => {
    if (tabId === 'trustees') return `Trustees (${count})`;
    if (tabId === 'patrons') return `Patrons (${count})`;
    return `Members (${count})`;
  };

  const trusteeTabs = useMemo(() => {
    const trusteesCount = getTrusteesCount();
    const patronsCount = getPatronsCount();
    const regularMembersCount = getRegularMembersCount();

    const tabs = [];

    if (trusteesCount > 0) {
      tabs.push({
        id: 'trustees',
        label: getTrusteeTabLabel('trustees', trusteesCount),
        icon: Star,
        icon_url: getSubFeatureIconUrl('members'),
        enabled: isDirectoryEnabled && isMembersTabEnabled
      });
    }

    if (patronsCount > 0) {
      tabs.push({
        id: 'patrons',
        label: getTrusteeTabLabel('patrons', patronsCount),
        icon: UserPlus,
        icon_url: getSubFeatureIconUrl('members'),
        enabled: isDirectoryEnabled && isMembersTabEnabled
      });
    }

    // Show a general Members tab for non-governance, non-patron members
    if (regularMembersCount > 0) {
      tabs.push({
        id: 'members',
        label: getTrusteeTabLabel('members', regularMembersCount),
        icon: Users,
        icon_url: getSubFeatureIconUrl('members'),
        enabled: isDirectoryEnabled && isMembersTabEnabled
      });
    }

    const filtered = tabs.filter((t) => t.enabled);
    const orderMap = { trustees: 1, patrons: 2, members: 3 };
    filtered.sort((a, b) => (orderMap[a.id] || 99) - (orderMap[b.id] || 99));
    return filtered;
  }, [getTrusteesCount, getPatronsCount, getRegularMembersCount, isDirectoryEnabled, isMembersTabEnabled, getSubFeatureIconUrl]);

  // Committee Directory Tabs Ã¢â‚¬â€ memoized
  const committeeTabs = useMemo(() => {
    const tabs = [
      {
        id: 'elected',
        label: `${getSubFeatureDisplayName('elected', 'Elected')} (${getElectedMembersCount()})`,
        icon: Star,
        icon_url: getSubFeatureIconUrl('elected'),
        enabled: isDirectoryEnabled && isElectedTabEnabled
      },
      {
        id: 'committee',
        label: `${getSubFeatureDisplayName('committee', 'Committee')} (${getCommitteeCount()})`,
        icon: Users,
        icon_url: getSubFeatureIconUrl('committee'),
        enabled: isDirectoryEnabled && isCommitteeTabEnabled
      },
    ].filter((t) => t.enabled);
    tabs.sort((a, b) => getSubFeatureOrder(a.id) - getSubFeatureOrder(b.id));
    return tabs;
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [electedMembers, committeeMembers, isDirectoryEnabled, isElectedTabEnabled, isCommitteeTabEnabled, subFeatureMeta]);

  // Get current tabs based on selected directory Ã¢â‚¬â€ memoized
  const currentTabs = useMemo(() =>
    selectedDirectory === 'healthcare' ? healthcareTabs :
      selectedDirectory === 'committee' ? committeeTabs : trusteeTabs,
    [selectedDirectory, healthcareTabs, trusteeTabs, committeeTabs]);

  const directoryCards = useMemo(() => {
    const cards = [
      {
        id: 'trustee',
        tabKey: trusteeTabs[0]?.id || 'members',
        title: getSubFeatureDisplayName('members', 'Members Directory'),
        tagline: getSubFeatureTagline('members', 'Find all trust members'),
        countText: dataLoaded ? `${allMembers.length} Members` : 'Loading...',
        enabled: canShowTrustee,
        icon: DIRECTORY_ICON_MAP.members,
        icon_url: getSubFeatureIconUrl('members'),
      },
      {
        id: 'healthcare',
        tabKey: healthcareTabs[0]?.id || 'doctors',
        title: getSubFeatureDisplayName('healthcare', 'Hospitals & Doctors'),
        tagline: getSubFeatureTagline('healthcare', 'Find doctors and hospitals'),
        countText: dataLoaded ? `${getDoctorsCount()} Profiles` : 'Loading...',
        enabled: canShowHealthcare,
        icon: DIRECTORY_ICON_MAP.healthcare,
        icon_url: getSubFeatureIconUrl('healthcare'),
      },
      {
        id: 'committee',
        tabKey: committeeTabs[0]?.id || 'committee',
        title: getSubFeatureDisplayName('committee', 'Committee Directory'),
        tagline: getSubFeatureTagline('committee', 'Find committee and elected members'),
        countText: dataLoaded ? `${getCommitteeCount() + getElectedMembersCount()} Profiles` : 'Loading...',
        enabled: canShowCommittee,
        icon: DIRECTORY_ICON_MAP.committee,
        icon_url: getSubFeatureIconUrl('committee'),
      },
    ];

    const filtered = cards.filter((card) => card.enabled);
    filtered.sort((a, b) => {
      const aOrder = getSubFeatureOrder(a.tabKey === 'members' ? 'members' : a.id);
      const bOrder = getSubFeatureOrder(b.tabKey === 'members' ? 'members' : b.id);
      return aOrder - bOrder;
    });
    return filtered;
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [allMembers.length, canShowTrustee, canShowHealthcare, canShowCommittee, dataLoaded, healthcareTabs, committeeTabs, subFeatureMeta, opdDoctors.length, hospitals.length, electedMembers.length, committeeMembers.length]);

  const directoryTitleMap = {
    healthcare: getSubFeatureDisplayName('healthcare', 'Hospitals & Doctors'),
    committee: getSubFeatureDisplayName('committee', 'Committee Directory'),
    trustee: getSubFeatureDisplayName('members', 'Members Directory')
  };
  const directorySubtitleMap = {
    healthcare: getSubFeatureTagline('healthcare', 'Find Doctors & Hospitals'),
    committee: getSubFeatureTagline('committee', 'Find Committee Members'),
    trustee: getSubFeatureTagline('members', 'Find Members')
  };

  const getTrusteeSectionTitle = () => {
    if (activeTab === 'trustees') return 'Trustee Directory';
    if (activeTab === 'patrons') return 'Patron Directory';
    return directoryTitleMap.trustee;
  };

  const getTrusteeSectionSubtitle = () => {
    if (activeTab === 'trustees') return 'Find Trustees';
    if (activeTab === 'patrons') return 'Find Patrons';
    return directorySubtitleMap.trustee;
  };

  useEffect(() => {
    const dirEnabled =
      (selectedDirectory === 'healthcare' && canShowHealthcare) ||
      (selectedDirectory === 'trustee' && canShowTrustee) ||
      (selectedDirectory === 'committee' && canShowCommittee);

    if (selectedDirectory && !dirEnabled) {
      setSelectedDirectory(null);
      setActiveTab(null);
      return;
    }

    if (selectedDirectory && currentTabs.length > 0) {
      // Only update activeTab if it is missing or no longer valid for current tabs.
      // Guard prevents the effect from triggering again after setActiveTab.
      const tabIsValid = activeTab && currentTabs.some((t) => t.id === activeTab);
      if (!tabIsValid) {
        setActiveTab(currentTabs[0].id);
      }
    }
    // featureFlags intentionally omitted Ã¢â‚¬â€ currentTabs already reacts to it via useMemo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDirectory, currentTabs]);

  // Filter members based on current selection and search
  useEffect(() => {
    let membersToFilter = [];

    if (selectedDirectory && currentTabs.length > 0) {
      // Get members for the currently selected tab
      const currentTabId = currentTabs.some((tab) => tab.id === activeTab)
        ? activeTab
        : currentTabs[0]?.id;
      membersToFilter = getMembersByDirectoryAndTab(selectedDirectory, currentTabId);
    } else {
      membersToFilter = [];
    }

    const query = String(searchQuery || '').trim().toLowerCase();
    if (!query) {
      const sortedMembers = sortMembersByMembershipNumber(membersToFilter);
      setFilteredMembers(sortedMembers);
      previousFilteredRef.current = sortedMembers;
      setCurrentPage(1);
      return;
    }

    // Apply search filter
    const filtered = membersToFilter.filter(item =>
      (item.Name && item.Name.toLowerCase().includes(query)) ||
      (item.hospital_name && item.hospital_name.toLowerCase().includes(query)) ||
      (item.member_name_english && item.member_name_english.toLowerCase().includes(query)) ||
      (item['Company Name'] && item['Company Name'].toLowerCase().includes(query)) ||
      (item.trust_name && item.trust_name.toLowerCase().includes(query)) ||
      (item.committee_name_hindi && item.committee_name_hindi.toLowerCase().includes(query)) ||
      (item.type && item.type.toLowerCase().includes(query)) ||
      (item.hospital_type && item.hospital_type.toLowerCase().includes(query)) ||
      (item.member_role && item.member_role.toLowerCase().includes(query)) ||
      (item['Membership number'] && String(item['Membership number']).toLowerCase().includes(query)) ||
      (item.department && item.department.toLowerCase().includes(query)) ||
      (item.designation && item.designation.toLowerCase().includes(query)) ||
      (item.city && item.city.toLowerCase().includes(query)) ||
      (item.consultant_name && item.consultant_name.toLowerCase().includes(query)) ||
      (item.position && item.position.toLowerCase().includes(query)) ||
      (item.location && item.location.toLowerCase().includes(query)) ||
      (item.member_id && item.member_id.toLowerCase().includes(query)) ||
      (item.Mobile && String(item.Mobile).toLowerCase().includes(query)) ||
      (item.Mobile2 && String(item.Mobile2).toLowerCase().includes(query))
    );

    const sortedMembers = sortMembersByMembershipNumber(filtered);
    setFilteredMembers(sortedMembers);
    previousFilteredRef.current = sortedMembers;
    // Reset to first page when search, tab, or directory changes
    setCurrentPage(1);
    // currentTabs removed from deps Ã¢â‚¬â€ getMembersByDirectoryAndTab (useCallback) already
    // depends on the underlying data; adding currentTabs caused a new-array-reference loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDirectory, activeTab, searchQuery, allMembers, opdDoctors, opdDoctorsLoading, hospitals, electedMembers, committeeMembers]);

  // Scroll to top of the scrollable area whenever directory or tab changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [selectedDirectory, activeTab]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredMembers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentPageMembers = filteredMembers.slice(startIndex, endIndex);

  // Fetch profile photos for the current page members
  useEffect(() => {
    const fetchPhotos = async () => {
      if (!currentPageMembers.length) return;

      const memberIds = new Set();
      currentPageMembers.forEach(item => {
        // Collect all possible identifiers
        if (item['Membership number']) memberIds.add(item['Membership number']);
        if (item.membership_number) memberIds.add(item.membership_number);
        if (item.Mobile) memberIds.add(item.Mobile);
        if (item.mobile) memberIds.add(item.mobile);
        if (item.phone1) memberIds.add(item.phone1);
        if (item.member_id) memberIds.add(item.member_id);
      });

      const idsToFetch = Array.from(memberIds).filter(id => id && id !== 'N/A');
      if (idsToFetch.length === 0) return;

      try {
        const response = await getProfilePhotos(idsToFetch);
        if (response.success && response.photos) {
          setProfilePhotos(prev => ({ ...prev, ...response.photos }));
        }
      } catch (err) {
        console.error('Error fetching profile photos:', err);
      }
    };

    fetchPhotos();
  }, [currentPageMembers]);

  // Helper to get photo for a member
  const getMemberPhoto = (item) => {
    // For doctors from opd_schedule, use doctor_image_url directly
    if (item.doctor_image_url) return item.doctor_image_url;
    return profilePhotos[item['Membership number']] ||
      profilePhotos[item.membership_number] ||
      profilePhotos[item.Mobile] ||
      profilePhotos[item.mobile] ||
      profilePhotos[item.phone1] ||
      profilePhotos[item.member_id];
  };

  const containerRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.log('[NavbarText][HealthcareTrusteeDirectory]', {
      selectedTrustId: localStorage.getItem('selected_trust_id') || null,
      templateId: theme?.templateId || null,
      resolvedNavbarTextColor: navbarTextColor,
      finalAppliedNavbarTextColor: navbarTextColor,
      source: theme?.themeLoadSource || 'unknown',
      previouslyHardcodedOverridesRemoved: ['Menu text-white', 'Title text-white', 'Home icon text-white']
    });
  }, [navbarTextColor, theme?.templateId, theme?.themeLoadSource]);

  return (
    <div className={`h-screen flex flex-col relative${isMenuOpen ? ' overflow-hidden' : ' overflow-hidden'}`} ref={containerRef} style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      {/* Navbar - Brand theme */}
      <div
        className="px-4 py-4 flex items-center justify-between sticky top-0 z-50 shadow-md pointer-events-auto"
        style={{
          background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
          backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          borderBottom: '1px solid var(--navbar-border)',
          paddingTop: "max(env(safe-area-inset-top, 0px), 22px)",
          color: navbarTextColor
        }}
      >
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="p-2 rounded-xl transition-colors pointer-events-auto"
          style={{ color: navbarTextColor, background: 'transparent' }}
        >
          {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
        <h1 className="text-base font-bold tracking-wide" style={{ color: navbarTextColor }}>
          {getFeatureDisplayName('feature_directory', 'Directory')}
        </h1>
        <button
          onClick={() => onNavigate('home')}
          className="p-2 rounded-xl transition-colors flex items-center justify-center"
          style={{ color: navbarTextColor, background: 'transparent' }}
        >
          <HomeIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Sidebar */}
      {error && (
        <div className="px-6 py-4 flex-shrink-0">
          <div className="rounded-xl p-4 text-center" style={{ background: 'var(--brand-red-light)', border: '1px solid color-mix(in srgb, var(--brand-red) 18%, transparent)' }}>
            <p className="font-medium" style={{ color: 'var(--brand-red-dark)' }}>{error}</p>
            <button
              onClick={() => {
                setError(null);
                fetchMembers(false);
              }}
              className="mt-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-navy) 100%)', color: 'var(--surface-color)' }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {loading && !dataLoaded && (
        <div className="px-6 py-4 flex-shrink-0">
          <div className="flex justify-center items-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--brand-red)', borderBottomColor: 'transparent' }}></div>
          </div>
        </div>
      )}

      <Sidebar
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onNavigate={onNavigate}
        currentPage="healthcare-directory"
      />

      {/* Ã¢â€â‚¬Ã¢â€â‚¬ Scrollable content area Ã¢â€â‚¬Ã¢â€â‚¬ */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>

        {/* Directory Selection Screen */}
        {!selectedDirectory && (
          <div>
            {/* Hero Header */}
            <div
              className="px-6 pt-8 pb-10"
              style={{ background: 'linear-gradient(160deg, var(--brand-navy-light) 0%, color-mix(in srgb, var(--brand-red-light) 68%, var(--surface-color)) 60%, var(--surface-color) 100%)' }}
            >
              <div className="flex items-center gap-4 mb-2">
                <div
                  className="h-14 w-14 rounded-2xl flex items-center justify-center shadow-lg flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-navy) 100%)' }}
                >
                  <Users className="h-7 w-7" style={{ color: 'var(--surface-color)' }} />
                </div>
                <div>
                  <h1 className="text-2xl font-extrabold" style={{ color: 'var(--brand-navy)' }}>
                    {getSubFeatureDisplayName('members', 'Members Directory')}
                  </h1>
                  <p className="text-sm font-medium" style={{ color: 'var(--brand-red)' }}>
                    {getSubFeatureTagline('members', 'Find and explore trust members')}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-5 -mt-5 space-y-4">
              {directoryCards.length === 0 && (
                <div className="rounded-2xl p-6 shadow-sm text-center text-sm" style={{ background: 'var(--surface-color)', border: '1px solid color-mix(in srgb, var(--brand-navy) 10%, transparent)', color: 'color-mix(in srgb, var(--body-text-color) 70%, var(--surface-color))' }}>
                  Members directory is disabled right now.
                </div>
              )}

              {directoryCards.map((card) => {
                const CardIcon = card.icon || Users;
                return (
                <div
                  key={card.id}
                  className="rounded-2xl overflow-hidden shadow-md cursor-pointer group active:scale-[0.98] transition-all duration-200"
                  style={{ background: 'var(--surface-color)', border: '1px solid color-mix(in srgb, var(--brand-navy) 10%, transparent)', boxShadow: '0 8px 32px color-mix(in srgb, var(--brand-navy) 10%, transparent), 0 2px 8px color-mix(in srgb, var(--brand-red) 6%, transparent)' }}
                  onClick={() => {
                    setSelectedDirectory(card.id);
                    setActiveTab(card.tabKey || null);
                    setSearchQuery('');
                  }}
                >
                  {/* Top accent */}
                  <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, var(--brand-red) 0%, var(--brand-navy) 100%)' }} />
                  <div className="p-5 flex items-center gap-4">
                    <div
                      className="h-16 w-16 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-md"
                      style={{ background: 'linear-gradient(135deg, var(--brand-navy-light) 0%, color-mix(in srgb, var(--brand-navy-light) 72%, var(--surface-color)) 100%)' }}
                    >
                      {card.icon_url ? (
                        <img
                          src={card.icon_url}
                          alt={card.title}
                          className="h-10 w-10 object-contain"
                          onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <CardIcon className="h-8 w-8" style={{ color: 'var(--brand-navy)' }} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-extrabold text-lg leading-tight" style={{ color: 'var(--heading-color)' }}>{card.title}</h3>
                      <p className="text-sm mt-0.5" style={{ color: 'color-mix(in srgb, var(--body-text-color) 68%, var(--surface-color))' }}>{card.tagline}</p>
                      <div className="flex items-center gap-2 mt-3">
                        <span
                          className="px-3 py-1 rounded-full text-xs font-bold"
                          style={{ background: 'var(--brand-red-light)', color: 'var(--brand-red-dark)' }}
                        >
                          {card.countText}
                        </span>
                      </div>
                    </div>
                    <div
                      className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--brand-navy-light)' }}
                    >
                      <ChevronRight className="h-5 w-5" style={{ color: 'var(--brand-navy)' }} />
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        )}

        {/* Healthcare or Trustee Directory View */}
        {selectedDirectory && (
          <div>
            {/* Hero Header */}
            <div
              className="px-5 pt-5 pb-8"
              style={{ background: 'linear-gradient(160deg, var(--brand-navy-light) 0%, color-mix(in srgb, var(--brand-red-light) 68%, var(--surface-color)) 60%, var(--surface-color) 100%)' }}
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedDirectory(null)}
                  className="p-2 rounded-xl transition-colors flex-shrink-0"
                  style={{ color: 'var(--brand-navy)', background: 'transparent' }}
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div>
                  <h1 className="text-xl font-extrabold leading-tight" style={{ color: 'var(--brand-navy)' }}>
                    {selectedDirectory === 'trustee' ? getTrusteeSectionTitle() : directoryTitleMap[selectedDirectory] || 'Members Directory'}
                  </h1>
                  <p className="text-xs font-semibold mt-0.5" style={{ color: 'var(--brand-red)' }}>
                    {selectedDirectory === 'trustee' ? getTrusteeSectionSubtitle() : directorySubtitleMap[selectedDirectory] || 'Find Members'}
                  </p>
                </div>
              </div>
            </div>

            {/* Search Section */}
            <div className="px-5 -mt-4">
              <div
                className="rounded-2xl p-2.5 flex items-center gap-3 shadow-md transition-all focus-within:shadow-lg"
                style={{ background: 'var(--surface-color)', border: '2px solid var(--brand-navy-light)' }}
              >
                <div
                  className="p-2 rounded-xl ml-1"
                  style={{ background: 'var(--brand-navy-light)' }}
                >
                  <Search className="h-5 w-5" style={{ color: 'var(--brand-navy)' }} />
                </div>
                <input
                  type="text"
                  placeholder={`Name, Membership No., Mobile - ${selectedDirectory === 'trustee' ? (activeTab === 'trustees' ? 'Trustees' : activeTab === 'patrons' ? 'Patrons' : 'Members') : (directoryTitleMap[selectedDirectory] || 'Members')}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent border-none focus:ring-0 placeholder:opacity-65 font-semibold text-sm py-2"
                  style={{ color: 'var(--body-text-color)' }}
                />
                {searchQuery ? (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="h-8 w-8 rounded-lg flex items-center justify-center transition-colors"
                    style={{ color: 'color-mix(in srgb, var(--body-text-color) 60%, var(--surface-color))' }}
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Tabs - shown only when multiple sections exist */}
            {currentTabs.length > 1 && (
              <div className="px-5 mt-4">
                <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                  {currentTabs.map((tab) => {
                    const isActive = activeTab === tab.id || (!activeTab && currentTabs[0]?.id === tab.id);
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id);
                          setSearchQuery('');
                        }}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold whitespace-nowrap transition-all text-xs"
                        style={isActive
                          ? { background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-navy) 100%)', color: 'var(--surface-color)', boxShadow: '0 4px 12px color-mix(in srgb, var(--brand-red) 25%, transparent)' }
                          : { background: 'var(--surface-color)', color: 'var(--brand-navy)', border: '1.5px solid var(--brand-navy-light)' }
                        }
                      >
                        {tab.icon_url ? (
                          <img
                            src={tab.icon_url}
                            alt={tab.label}
                            className="h-4 w-4 object-contain"
                            onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                          />
                        ) : (
                          <tab.icon className="h-4 w-4" style={{ color: isActive ? 'var(--surface-color)' : 'var(--brand-red)' }} />
                        )}
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Content List - Modern Cards */}
            <div className="px-5 mt-4 space-y-3" ref={contentRef}>
              {loading && !dataLoaded ? (
                <div className="flex justify-center items-center py-20">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2-2 mx-auto mb-4" style={{ borderColor: 'var(--brand-red)', borderBottomColor: 'transparent' }}></div>
                    <p className="text-sm" style={{ color: 'color-mix(in srgb, var(--body-text-color) 70%, var(--surface-color))' }}>Loading directory...</p>
                  </div>
                </div>
              ) : currentPageMembers.length > 0 ? (
                currentPageMembers.map((item) => (
                  <div
                    key={item['S. No.'] || item.id || Math.random()}
                    className="rounded-2xl p-4 flex items-center gap-4 group cursor-pointer active:scale-[0.98] transition-all duration-200"
                    style={{ background: 'var(--surface-color)', boxShadow: '0 2px 12px color-mix(in srgb, var(--brand-navy) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--brand-navy) 8%, transparent)' }}
                    onClick={() => {
                      const currentTabId = activeTab || currentTabs[0]?.id;
                      const isElectedContext = selectedDirectory === 'committee' && currentTabId === 'elected';

                      // Check if this is a committee group (committee name)
                      // Skip this path when we're in the elected tab.
                      if (!isElectedContext && item.is_committee_group) {
                        // Navigate to a new view showing all members of this committee
                        const filteredCommitteeMembers = committeeMembers.filter(cm =>
                          (cm.committee_name_english === item.Name) || (cm.committee_name_hindi === item.Name)
                        );

                        const committeeData = {
                          'Name': item.Name,
                          'type': 'Committee',
                          'committee_members': filteredCommitteeMembers,
                          'committee_name_english': item.committee_name_english,
                          'committee_name_hindi': item.committee_name_hindi,
                          'is_committee_group': true
                        };

                        // Add the current directory type as the previous screen name
                        committeeData.previousScreenName = selectedDirectory;

                        // Store the current directory and tab in sessionStorage to restore when coming back
                        sessionStorage.setItem('restoreDirectory', selectedDirectory);
                        sessionStorage.setItem('restoreDirectoryTab', activeTab);

                        onNavigate('committee-members', committeeData);
                      } else {
                        // Navigate to member details page
                        // Determine if this is a healthcare member (from opd_schedule)
                        const isHealthcareMember = !!item.consultant_name || (item.original_id && item.original_id.toString().startsWith('DOC'));
                        // Determine if this is a committee member (from committee_members table)
                        const isCommitteeMember = !!item.is_committee_member || (item.original_id && item.original_id.toString().startsWith('CM'));
                        // Determine if this is a hospital member (from hospitals table)
                        const isHospitalMember = !!item.is_hospital ||
                          (item.original_id && item.original_id.toString().startsWith('HOSP')) ||
                          (item['S. No.'] && item['S. No.'].toString().startsWith('HOSP'));
                        // Determine if this is an elected member (from elected_members table)
                        const isElectedMember = isElectedContext || !!item.is_elected_member ||
                          (item.elected_id !== undefined && item.elected_id !== null) ||
                          (item.original_id && item.original_id.toString().startsWith('ELECT')) ||
                          (item['S. No.'] && item['S. No.'].toString().startsWith('ELECT'));

                        // Create member data based on the source
                        const memberData = {
                          'S. No.': item['S. No.'] || item.original_id || `MEM${Math.floor(Math.random() * 10000)}`,
                          'Name': item.member_name_english || item.Name || item.hospital_name || item.consultant_name || 'N/A',
                          'Mobile': item.Mobile || item.contact_phone || item.mobile || 'N/A',
                          'Email': item.Email || item.contact_email || item.email || 'N/A',
                          'type': item.member_role || item.type || item.Type || 'N/A',
                          'Membership number': item['Membership number'] || item.membership_number || item.membership_number_elected || 'N/A',
                          'isHealthcareMember': isHealthcareMember,
                          'isCommitteeMember': isCommitteeMember,
                          'isHospitalMember': isHospitalMember,
                          'isElectedMember': isElectedMember
                        };

                        // Add hospital-specific fields (from hospitals table) only if it's a hospital member
                        if (isHospitalMember) {
                          memberData.hospital_name = item.hospital_name || 'N/A';
                          memberData.trust_name = item.trust_name || 'N/A';
                          memberData.hospital_type = item.hospital_type || 'N/A';
                          memberData.address = item.address || 'N/A';
                          memberData.city = item.city || 'N/A';
                          memberData.state = item.state || 'N/A';
                          memberData.pincode = item.pincode || 'N/A';
                          memberData.established_year = item.established_year || 'N/A';
                          memberData.bed_strength = item.bed_strength || 'N/A';
                          memberData.accreditation = item.accreditation || 'N/A';
                          memberData.facilities = item.facilities || 'N/A';
                          memberData.departments = item.departments || 'N/A';
                          memberData.contact_phone = item.contact_phone || 'N/A';
                          memberData.contact_email = item.contact_email || 'N/A';
                          memberData.is_active = item.is_active || 'N/A';
                          memberData.id = item.original_id || null;
                        } else if (isCommitteeMember) {
                          // Add committee-specific fields (from committee_members table)
                          memberData.committee_name_hindi = item.committee_name_hindi || 'N/A';
                          memberData.member_name_english = item.member_name_english || 'N/A';
                          memberData.member_role = item.member_role || 'N/A';
                          memberData['Company Name'] = item.committee_name_hindi || item['Company Name'] || 'N/A';
                        } else if (!isHealthcareMember && !isElectedMember) {
                          // Add general member fields (from Members Table) only if not healthcare, committee, or elected
                          if (item['Company Name']) memberData['Company Name'] = item['Company Name'];
                          if (item['Address Home']) memberData['Address Home'] = item['Address Home'];
                          if (item['Address Office']) memberData['Address Office'] = item['Address Office'];
                          if (item['Resident Landline']) memberData['Resident Landline'] = item['Resident Landline'];
                          if (item['Office Landline']) memberData['Office Landline'] = item['Office Landline'];
                        }

                        // Add Members Table fields for elected members (since they're merged with Members Table)
                        if (isElectedMember) {
                          if (item['Company Name']) memberData['Company Name'] = item['Company Name'];
                          if (item['Address Home']) memberData['Address Home'] = item['Address Home'];
                          if (item['Address Office']) memberData['Address Office'] = item['Address Office'];
                          if (item['Resident Landline']) memberData['Resident Landline'] = item['Resident Landline'];
                          if (item['Office Landline']) memberData['Office Landline'] = item['Office Landline'];

                          // Add elected-specific fields from elected_members table
                          memberData.position = item.position || 'N/A';
                          memberData.location = item.location || 'N/A';
                          memberData.elected_id = item.elected_id || item.original_id || item.id || item.reg_id || null;
                          memberData.membership_number_elected = item.membership_number || item.membership_number_elected || item['Membership number'] || 'N/A';
                          memberData.created_at = item.created_at || 'N/A';
                          memberData.is_merged_with_member = item.is_merged_with_member || false;
                        }

                        // Add healthcare-specific fields (from opd_schedule) only if it's a healthcare member
                        if (isHealthcareMember) {
                          memberData.department = item.department || 'N/A';
                          memberData.designation = item.designation || item.specialization || 'N/A';
                          memberData.qualification = item.qualification || 'N/A';
                          memberData.senior_junior = item.senior_junior || 'N/A';
                          memberData.unit = item.unit || 'N/A';
                          memberData.general_opd_days = item.general_opd_days || 'N/A';
                          memberData.private_opd_days = item.private_opd_days || 'N/A';
                          memberData.unit_notes = item.unit_notes || 'N/A';
                          memberData.consultant_name = item.consultant_name || item.Name || 'N/A';
                          memberData.notes = item.notes || item.unit_notes || 'N/A';
                          memberData.id = item.id || item.original_id || null;
                        } else if (!isCommitteeMember && !isHospitalMember && !isElectedMember) {
                          // For non-healthcare, non-committee, non-hospital, non-elected members, use original field values if they exist
                          if (item.designation) memberData.designation = item.designation;
                          if (item.qualification) memberData.qualification = item.qualification;
                          if (item.notes) memberData.notes = item.notes;
                        }

                        // Add the current directory type as the previous screen name
                        memberData.previousScreenName = selectedDirectory;

                        // Store the current directory and tab in sessionStorage to restore when coming back
                        sessionStorage.setItem('restoreDirectory', selectedDirectory);
                        sessionStorage.setItem('restoreDirectoryTab', activeTab);

                        onNavigate('member-details', memberData);
                      }
                    }}
                  >
                    {/* Avatar / Doctor Image */}
                    {selectedDirectory === 'healthcare' && activeTab === 'doctors' ? (
                      // Ã¢â€â‚¬Ã¢â€â‚¬ Doctor card: large image + rich details Ã¢â€â‚¬Ã¢â€â‚¬
                      <div className="flex gap-4 w-full">
                        {/* Doctor Photo */}
                        <div className="flex-shrink-0 h-20 w-20 rounded-2xl overflow-hidden flex items-center justify-center border shadow-sm" style={{ background: 'linear-gradient(135deg, var(--brand-navy-light) 0%, var(--brand-red-light) 100%)', borderColor: 'color-mix(in srgb, var(--brand-navy) 14%, transparent)' }}>
                          {getMemberPhoto(item) ? (
                            <img
                              src={getMemberPhoto(item)}
                              alt={item.consultant_name || item.Name || 'Doctor'}
                              className="w-full h-full object-cover"
                              onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                            />
                          ) : (
                            <Stethoscope className="h-8 w-8" style={{ color: 'var(--brand-red)' }} />
                          )}
                        </div>

                        {/* Doctor Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-bold text-sm leading-tight transition-colors group-hover:opacity-85" style={{ color: 'var(--heading-color)' }}>
                              {item.consultant_name || item.Name || 'N/A'}
                            </h3>
                            <div className="p-1.5 rounded-full flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--surface-color) 82%, var(--app-accent-bg))' }}>
                              <ChevronRight className="h-4 w-4" style={{ color: 'color-mix(in srgb, var(--body-text-color) 35%, var(--surface-color))' }} />
                            </div>
                          </div>

                          {/* Department */}
                          {item.department && (
                            <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: 'var(--brand-navy)', background: 'var(--brand-navy-light)' }}>
                              {item.department}
                            </span>
                          )}

                          {/* Designation + Qualification */}
                          {(item.designation || item.qualification) && (
                            <p className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-block mt-1" style={{ color: 'var(--brand-red-dark)', background: 'var(--brand-red-light)' }}>
                              {[item.designation, item.qualification].filter(Boolean).join(' | ')}
                            </p>
                          )}

                          {/* Experience + Fee row */}
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            {item.experience_years && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: 'var(--brand-red-dark)', background: 'color-mix(in srgb, var(--brand-red-light) 42%, var(--surface-color))' }}>
                                {item.experience_years}+ yrs exp
                              </span>
                            )}
                            {item.consultation_fee && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: 'var(--brand-navy)', background: 'color-mix(in srgb, var(--brand-navy-light) 60%, var(--surface-color))' }}>
                                Ã¢â€šÂ¹{item.consultation_fee} fee
                              </span>
                            )}
                          </div>

                          {/* OPD Days */}
                          {(item.general_opd_days || item.private_opd_days) && (
                            <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: 'color-mix(in srgb, var(--body-text-color) 70%, var(--surface-color))' }}>
                              {item.general_opd_days && <span><span className="font-semibold" style={{ color: 'var(--body-text-color)' }}>OPD:</span> {item.general_opd_days}</span>}
                              {item.general_opd_days && item.private_opd_days && ' Ã‚Â· '}
                              {item.private_opd_days && <span><span className="font-semibold" style={{ color: 'var(--body-text-color)' }}>Pvt:</span> {item.private_opd_days}</span>}
                            </p>
                          )}

                          {/* Call button */}
                          {(item.mobile || item.Mobile) && (
                            <a
                              href={`tel:${(item.mobile || item.Mobile).replace(/\s+/g, '').split(',')[0]}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                              style={{ background: 'color-mix(in srgb, var(--surface-color) 82%, var(--app-accent-bg))', border: '1px solid color-mix(in srgb, var(--brand-navy) 12%, transparent)', color: 'var(--body-text-color)' }}
                            >
                              <Phone className="h-3 w-3" />
                              Call
                            </a>
                          )}
                        </div>
                      </div>
                    ) : (
                      // Ã¢â€â‚¬Ã¢â€â‚¬ Generic card for hospitals, trustees, patrons, committee Ã¢â€â‚¬Ã¢â€â‚¬
                      <>
                        <div
                          className="h-14 w-14 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0"
                          style={{ background: 'linear-gradient(135deg, var(--brand-navy-light) 0%, color-mix(in srgb, var(--brand-navy-light) 72%, var(--surface-color)) 100%)', border: '1.5px solid color-mix(in srgb, var(--brand-navy) 12%, transparent)' }}
                        >
                          {getMemberPhoto(item) ? (
                            <img
                              src={getMemberPhoto(item)}
                              alt={item.member_name_english || item.Name || 'Member'}
                              className="w-full h-full object-cover"
                              onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                            />
                          ) : (
                            selectedDirectory === 'healthcare' ? <Stethoscope className="h-7 w-7" style={{ color: 'var(--brand-navy)' }} /> :
                              selectedDirectory === 'committee' ? <Users className="h-7 w-7" style={{ color: 'var(--brand-navy)' }} /> : <Star className="h-7 w-7" style={{ color: 'var(--brand-navy)' }} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0">
                              <h3 className="font-bold text-sm leading-tight" style={{ color: 'var(--heading-color)' }}>
                                {item.member_name_english || item.Name || ''}
                              </h3>
                              <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {item['Membership number'] && item['Membership number'] !== 'N/A' && (
                                  <p className="text-xs font-medium" style={{ color: 'color-mix(in srgb, var(--body-text-color) 60%, var(--surface-color))' }}>{item['Membership number']}</p>
                                )}
                                {!(selectedDirectory === 'healthcare' && (activeTab === 'doctors' || activeTab === 'hospitals')) &&
                                  (item.position || item.member_role || item.type || item['Company Name']) &&
                                  (item.position || item.member_role || item.type || item['Company Name']) !== 'N/A' && (
                                    <span
                                      className="self-start text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full inline-block"
                                      style={{ background: 'var(--brand-navy-light)', color: 'var(--brand-navy)' }}
                                    >
                                      {item.position || item.member_role || item.type || item['Company Name']}
                                    </span>
                                  )}
                                {item.location && item.location !== 'N/A' && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: 'color-mix(in srgb, var(--brand-red-light) 34%, var(--surface-color))', color: 'var(--brand-red-dark)' }}>
                                    <MapPin className="h-3 w-3" />{item.location}
                                  </span>
                                )}
                                {(item.committee_name_hindi || (item.department && activeTab !== 'doctors')) &&
                                  (item.committee_name_hindi || item.department) !== 'N/A' && (
                                    <span
                                      className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-block"
                                      style={{ background: 'var(--brand-red-light)', color: 'var(--brand-red-dark)' }}
                                    >
                                      {item.committee_name_hindi || item.department}
                                    </span>
                                  )}
                                {(item.hospital_type || item.trust_name) &&
                                  (item.hospital_type || item.trust_name) !== 'N/A' && (
                                    <span className="text-[10px]" style={{ color: 'color-mix(in srgb, var(--body-text-color) 60%, var(--surface-color))' }}>{item.hospital_type || item.trust_name}</span>
                                  )}
                                {(item.designation || item.qualification) &&
                                  (item.designation || item.qualification) !== 'N/A' && (
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-block" style={{ background: 'color-mix(in srgb, var(--brand-navy-light) 62%, var(--surface-color))', color: 'var(--brand-navy)' }}>
                                      {item.designation}{item.qualification && item.qualification !== 'N/A' ? ` | ${item.qualification}` : ''}
                                    </span>
                                  )}
                                {item.city && item.city !== 'N/A' && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: 'color-mix(in srgb, var(--brand-red-light) 34%, var(--surface-color))', color: 'var(--brand-red-dark)' }}>
                                    <MapPin className="h-3 w-3" />{item.city}{item.state && item.state !== 'N/A' ? `, ${item.state}` : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div
                              className="h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                              style={{ background: 'var(--brand-navy-light)' }}
                            >
                              <ChevronRight className="h-4 w-4" style={{ color: 'var(--brand-navy)' }} />
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-3 flex-wrap">
                            {item.Mobile && item.Mobile !== 'N/A' && (
                              <a
                                href={`tel:${item.Mobile.replace(/\s+/g, '').split(',')[0]}`}
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                                style={{ background: 'var(--brand-red-light)', color: 'var(--brand-red-dark)', border: '1px solid rgba(192,36,26,0.15)' }}
                              >
                                <Phone className="h-3 w-3" />Call
                              </a>
                            )}
                            {item.Email && item.Email.trim() && item.Email !== 'N/A' && (
                              <a
                                href={`mailto:${item.Email.trim()}`}
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                                style={{ background: 'var(--brand-navy-light)', color: 'var(--brand-navy)', border: '1.5px solid color-mix(in srgb, var(--brand-navy) 12%, transparent)' }}
                              >
                                <Mail className="h-3 w-3" />Email
                              </a>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-20">
                  <div
                    className="h-20 w-20 rounded-full flex items-center justify-center mx-auto mb-4"
                    style={{ background: 'var(--brand-navy-light)', border: '2px dashed color-mix(in srgb, var(--brand-navy) 20%, transparent)' }}
                  >
                    <User className="h-8 w-8" style={{ color: 'var(--brand-navy)' }} />
                  </div>
                  <h3 className="font-bold" style={{ color: 'var(--heading-color)' }}>No results found</h3>
                  <p className="text-sm mt-1" style={{ color: 'color-mix(in srgb, var(--body-text-color) 60%, var(--surface-color))' }}>Try searching with a different keyword</p>
                </div>
              )}
            </div>

            {/* Pagination Controls */}
            {filteredMembers.length > itemsPerPage && (
              <div className="px-5 mt-5 mb-4">
                <div className="rounded-2xl px-3 py-3" style={{ background: 'linear-gradient(135deg, var(--brand-navy-light) 0%, var(--brand-red-light) 100%)', border: '1px solid color-mix(in srgb, var(--brand-navy) 10%, transparent)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => { setCurrentPage(prev => Math.max(1, prev - 1)); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      disabled={currentPage === 1}
                      className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all ${currentPage === 1 ? 'cursor-not-allowed' : 'active:scale-95'}`}
                      style={currentPage === 1
                        ? { background: 'color-mix(in srgb, var(--surface-color) 76%, var(--app-accent-bg))', color: 'color-mix(in srgb, var(--body-text-color) 35%, var(--surface-color))' }
                        : { background: 'var(--surface-color)', color: 'var(--brand-navy)', border: '1px solid var(--brand-navy-light)' }}
                    >
                      Ã¢â€ Â Prev
                    </button>
                    <div className="flex items-center gap-1">
                      {(() => {
                        const pages = [];
                        let start = Math.max(1, currentPage - 1);
                        let end = Math.min(totalPages, start + 2);
                        if (end - start < 2) start = Math.max(1, end - 2);
                        for (let p = start; p <= end; p++) {
                          pages.push(
                            <button
                              key={p}
                              onClick={() => { setCurrentPage(p); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                              className="w-9 h-9 rounded-xl font-bold text-sm transition-all"
                              style={currentPage === p
                                ? { background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-navy) 100%)', color: 'var(--surface-color)', boxShadow: '0 4px 12px color-mix(in srgb, var(--brand-red) 25%, transparent)' }
                                : { background: 'var(--surface-color)', color: 'var(--brand-navy)', border: '1.5px solid var(--brand-navy-light)' }
                              }
                            >{p}</button>
                          );
                        }
                        return pages;
                      })()}
                    </div>
                    <span className="text-[11px] font-semibold whitespace-nowrap" style={{ color: 'var(--brand-navy)' }}>
                      {startIndex + 1}Ã¢â‚¬â€œ{Math.min(endIndex, filteredMembers.length)} / {filteredMembers.length}
                    </span>
                    <button
                      onClick={() => { setCurrentPage(prev => Math.min(totalPages, prev + 1)); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      disabled={currentPage === totalPages}
                      className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all ${currentPage === totalPages ? 'cursor-not-allowed' : 'active:scale-95'}`}
                      style={currentPage === totalPages
                        ? { background: 'color-mix(in srgb, var(--surface-color) 76%, var(--app-accent-bg))', color: 'color-mix(in srgb, var(--body-text-color) 35%, var(--surface-color))' }
                        : { background: 'var(--surface-color)', color: 'var(--brand-navy)', border: '1px solid var(--brand-navy-light)' }}
                    >
                      Next Ã¢â€ â€™
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Extra Space for Bottom Nav */}
        <div className="h-10"></div>
      </div>
    </div>
  );
};

export default HealthcareTrusteeDirectory;
