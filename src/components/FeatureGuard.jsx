import React from 'react';
import { useNavigate } from 'react-router-dom';
import { isFeatureEnabled } from '../services/featureFlags';
import { useFeatureFlags } from '../hooks/useFeatureFlags';

const FeatureGuard = ({ featureKey, fallbackPath = '/', children }) => {
  const { flags, loading } = useFeatureFlags();
  const navigate = useNavigate();

  if (!featureKey) return children;
  if (loading) return null;

  const enabled = isFeatureEnabled(flags, featureKey);
  if (!enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
        <div className="text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-800 mb-2">Feature Unavailable</h2>
          <p className="text-gray-500 text-sm mb-6">This feature is currently not available. Please contact admin.</p>
          <button
            onClick={() => navigate(fallbackPath)}
            className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold text-sm active:scale-95 transition-all"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return children;
};

export default FeatureGuard;
