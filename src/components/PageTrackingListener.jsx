import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackNavigation } from '../services/pageTrackingService';

// Mounted once inside the router. Records every pathname change; renders nothing.
const PageTrackingListener = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    trackNavigation(pathname);
  }, [pathname]);

  return null;
};

export default PageTrackingListener;
