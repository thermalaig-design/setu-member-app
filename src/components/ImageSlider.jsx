import React, { useState, useEffect, useRef } from 'react';

const ImageSlider = ({ images, autoPlayInterval = 3000, onNavigate, onImageClick }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [translateX, setTranslateX] = useState(0);
  const sliderRef = useRef(null);
  const autoPlayRef = useRef(null);
  const resumeTimerRef = useRef(null);
  const dragDistanceRef = useRef(0);
  const startXRef = useRef(0);
  const isDraggingRef = useRef(false);
  const wasSwipeRef = useRef(false);
  const interactionLockRef = useRef(false);

  const clearTimers = () => {
    if (autoPlayRef.current) {
      clearInterval(autoPlayRef.current);
      autoPlayRef.current = null;
    }
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  };

  const startAutoPlay = () => {
    clearTimers();
    if (!Array.isArray(images) || images.length <= 1) return;
    autoPlayRef.current = setInterval(() => {
      if (isDraggingRef.current || interactionLockRef.current) return;
      setCurrentIndex((prev) => (prev + 1) % images.length);
    }, Math.max(3500, autoPlayInterval));
  };

  // Auto-play functionality
  useEffect(() => {
    startAutoPlay();
    return () => {
      clearTimers();
    };
  }, [images.length, autoPlayInterval]);

  // Touch/Mouse handlers
  const handleStart = (clientX) => {
    clearTimers();
    setIsDragging(true);
    isDraggingRef.current = true;
    startXRef.current = clientX;
    setTranslateX(0);
    dragDistanceRef.current = 0;
    wasSwipeRef.current = false;
  };

  const handleMove = (clientX) => {
    if (!isDraggingRef.current) return;
    const diff = clientX - startXRef.current;
    setTranslateX(diff);
    dragDistanceRef.current = Math.max(dragDistanceRef.current, Math.abs(diff));
  };

  const handleEnd = () => {
    if (!isDraggingRef.current) return;
    setIsDragging(false);
    isDraggingRef.current = false;

    const threshold = 40;
    if (translateX < -threshold) {
      wasSwipeRef.current = true;
      setCurrentIndex((prev) => (prev + 1) % images.length);
    } else if (translateX > threshold) {
      wasSwipeRef.current = true;
      setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
    }

    setTranslateX(0);
    interactionLockRef.current = true;
    resumeTimerRef.current = setTimeout(() => {
      interactionLockRef.current = false;
      startAutoPlay();
    }, 4500);
  };

  // Touch events
  const onTouchStart = (e) => handleStart(e.touches[0].clientX);
  const onTouchMove = (e) => handleMove(e.touches[0].clientX);
  const onTouchEnd = () => handleEnd();

  // Mouse events
  const onMouseDown = (e) => handleStart(e.clientX);
  const onMouseMove = (e) => {
    if (isDragging) handleMove(e.clientX);
  };
  const onMouseUp = () => handleEnd();
  const onMouseLeave = () => {
    if (isDraggingRef.current) handleEnd();
  };

  const handleSliderClick = () => {
    if (wasSwipeRef.current || dragDistanceRef.current > 8) return;
    if (typeof onImageClick === 'function') {
      onImageClick(currentIndex);
      return;
    }
    if (typeof onNavigate === 'function') onNavigate('gallery');
  };

  if (!images || images.length === 0) return null;

  return (
    <div className="relative w-full overflow-hidden rounded-xl">
      {/* Slider container */}
      <div
        ref={sliderRef}
        className="flex transition-transform duration-500 ease-in-out"
        style={{
          transform: `translateX(calc(-${currentIndex * 100}% + ${translateX}px))`,
          transition: isDragging ? 'none' : 'transform 500ms cubic-bezier(0.22, 0.61, 0.36, 1)',
          touchAction: 'pan-y'
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onClick={handleSliderClick}
      >
        {images.map((image, index) => (
          <div
            key={index}
            className="w-full flex-shrink-0"
            style={{ minWidth: '100%' }}
          >
            <img
              src={image.url}
              alt={image.label || `Image ${index + 1}`}
              loading={index === 0 ? 'eager' : 'lazy'}
              decoding="async"
              className="w-full h-56 sm:h-64 object-cover bg-slate-100"
              draggable={false}
            />
          </div>
        ))}
      </div>

      {/* Navigation dots */}
      {images.length > 1 && (
        <div className="absolute bottom-3 left-1/2 transform -translate-x-1/2 flex gap-2">
          {images.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                index === currentIndex
                  ? 'bg-white scale-125'
                  : 'bg-white/50 hover:bg-white/75'
              }`}
              aria-label={`Go to image ${index + 1}`}
            />
          ))}
        </div>
      )}

      {/* Image counter */}
      {images.length > 1 && (
        <div className="absolute top-3 right-3 px-2 py-1 rounded-full bg-black/50 text-white text-xs font-semibold">
          {currentIndex + 1} / {images.length}
        </div>
      )}
    </div>
  );
};

export default ImageSlider;
