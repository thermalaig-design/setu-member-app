import { useEffect, useState } from "react";

/**
 * Returns true only after `isLoading` has stayed true for `delay` ms.
 * Stops the loader from flashing when the RPC responds quickly.
 *
 *   const showLoader = useDelayedLoading(status === "loading", 300);
 *   {showLoader && <CategoriesLoading />}
 */
export default function useDelayedLoading(isLoading, delay = 300) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [isLoading, delay]);

  return show;
}