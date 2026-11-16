import React, { useEffect, useState } from 'react';

// Shows the product photo, or `fallback` when there is no URL or the image fails to load.
const OrderProductImage = ({ src, alt = '', fallback, ...imgProps }) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return fallback;
  return <img src={src} alt={alt} onError={() => setFailed(true)} {...imgProps} />;
};

export default OrderProductImage;
