import { useEffect, useState } from 'react';
import { fetchFeatureFlags, subscribeFeatureFlags } from '../services/featureFlags';

export const useFeatureFlags = (trustIdParam = null) => {
  const [flags, setFlags] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const resolveTrustId = () =>
      trustIdParam || localStorage.getItem('selected_trust_id') || null;

    const loadFlags = async (force = false) => {
      const trustId = resolveTrustId();
      const result = await fetchFeatureFlags(trustId, { force });
      if (!isMounted) return;
      if (result.success) {
        setFlags(result.flags || {});
      }
      setLoading(false);
    };

    loadFlags();

    const handleFocus = () => loadFlags(true);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') loadFlags(true);
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    const trustId = resolveTrustId();
    const unsubscribe = subscribeFeatureFlags(trustId, () => loadFlags(true));

    return () => {
      isMounted = false;
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribe?.();
    };
  }, [trustIdParam]);

  return { flags, loading };
};
