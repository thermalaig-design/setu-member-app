import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  Image as ImageIcon,
  LayoutGrid,
  Lightbulb,
  Package,
  Plus,
  Tag,
  X,
} from 'lucide-react';
import { useAppTheme } from '../context/ThemeContext';
import { getNavbarThemeStyles } from '../utils/themeUtils';
import { getContrastRatio } from '../utils/colorUtils';
import { CATALOG_GUIDES } from '../utils/catalogGuides';

const STEP_ICONS = {
  ArrowRight,
  Check,
  ChevronDown,
  Image: ImageIcon,
  LayoutGrid,
  Package,
  Plus,
  Tag,
};

// These overlays sit on their own fixed light surface instead of the themed
// page background, so text must not use theme text variables (--body-text-color,
// --heading-color, --page-text-color): themes change those to suit *their* page
// background, and they vanish here. Only the header (readable by construction,
// via getNavbarThemeStyles) and the accent colour follow the theme.
const INK = '#111827';
const MUTED = '#4b5563';
const CARD = '#ffffff';
const SHEET_BG = '#f3f5fa';
const LINE = 'rgba(17, 24, 39, 0.12)';
const FALLBACK_ACCENT = '#1f2a44';

// Black or white, whichever reads better on `bg`.
const readableOn = (bg) => {
  const onWhite = getContrastRatio(bg, '#ffffff');
  const onInk = getContrastRatio(bg, INK);
  if (onWhite === null || onInk === null) return '#ffffff';
  return onWhite >= onInk ? '#ffffff' : INK;
};

// Tint of the "TAP" hint box: Products steps are teal, save/confirm steps green,
// everything else amber.
const TAP_TONES = {
  Package: '#0d9488',
  Check: '#16a34a',
};
const DEFAULT_TAP_TONE = '#b45309';

function StepCard({ index, step, accent }) {
  const Icon = STEP_ICONS[step.icon] || Plus;
  const tone = TAP_TONES[step.icon] || DEFAULT_TAP_TONE;

  return (
    <li
      className="rounded-2xl p-4"
      style={{ background: CARD, boxShadow: '0 6px 18px rgba(17, 24, 39, 0.08)' }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
          style={{ background: accent, color: readableOn(accent) }}
        >
          {index + 1}
        </span>
        <h3 className="text-[15px] font-bold" style={{ color: INK }}>
          {step.title}
        </h3>
      </div>
      <p className="mt-2 text-[13px] leading-5" style={{ color: MUTED }}>
        {step.description}
      </p>
      <div
        className="mt-3 flex items-center gap-3 rounded-xl px-3 py-2.5"
        style={{
          border: `1.5px dashed color-mix(in srgb, ${tone} 45%, transparent)`,
          background: `color-mix(in srgb, ${tone} 8%, ${CARD})`,
        }}
      >
        <span
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ background: `color-mix(in srgb, ${tone} 18%, transparent)` }}
        >
          <Icon className="h-4 w-4" style={{ color: tone }} />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: tone }}>
            Tap
          </div>
          <div className="text-[13px] font-bold leading-4" style={{ color: INK }}>
            {step.tap}
          </div>
        </div>
      </div>
    </li>
  );
}

export function HowToSheet({ guide, onClose, onSwitchGuide }) {
  const content = CATALOG_GUIDES[guide];
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const accent = theme?.primary || FALLBACK_ACCENT;
  const headerText = navbarTheme?.textColor || '#ffffff';

  useEffect(() => {
    if (!content) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [content, onClose]);

  if (!content || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={content.title}
      className="fixed inset-0 z-[80] mx-auto flex flex-col"
      style={{ width: 'min(100%, 430px)', background: SHEET_BG, color: INK }}
    >
      <div
        className="theme-navbar flex flex-shrink-0 items-center gap-2 px-3 py-3"
        style={{
          background: navbarTheme?.backgroundStyle || FALLBACK_ACCENT,
          color: headerText,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl p-2"
          style={{ color: headerText }}
          aria-label="Close guide"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        {/* Headings get a global dark colour from index.css, so set it explicitly. */}
        <h2 className="text-base font-extrabold" style={{ color: headerText }}>
          {content.title}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
        <h3 className="text-lg font-extrabold" style={{ color: INK }}>
          {content.heading}
        </h3>
        <p className="mt-1 text-[13px] leading-5" style={{ color: MUTED }}>
          {content.intro}
        </p>

        <ol className="mt-4 flex list-none flex-col gap-3 p-0">
          {content.steps.map((step, index) => (
            <StepCard key={step.title} index={index} step={step} accent={accent} />
          ))}
        </ol>

        <div
          className="mt-4 flex gap-2 rounded-2xl p-3 text-[13px] leading-5"
          style={{
            background: `color-mix(in srgb, #16a34a 10%, ${CARD})`,
            border: '1px solid color-mix(in srgb, #16a34a 30%, transparent)',
            color: INK,
          }}
        >
          <Lightbulb className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: '#15803d' }} />
          <span>
            <strong>Tip: </strong>
            {content.tip}
          </span>
        </div>

        {guide === 'category' ? (
          <button
            type="button"
            onClick={() => onSwitchGuide('product')}
            className="mt-4 w-full rounded-2xl py-3 text-sm font-bold"
            style={{ background: CARD, color: INK, border: `1px solid ${LINE}` }}
          >
            Next: how to add products →
          </button>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-2xl py-3.5 text-sm font-bold"
          style={{ background: accent, color: readableOn(accent) }}
        >
          Got it
        </button>
      </div>
    </div>,
    document.body
  );
}

const COACH_WIDTH = 240;
const COACH_MARGIN = 12;

// Floats a small tooltip under the top-bar "+" button (data-coach="add-products").
// Renders nothing when the button isn't on screen.
export function AddProductsCoachMark({ onDismiss, onLearn }) {
  const [position, setPosition] = useState(null);

  useEffect(() => {
    const update = () => {
      const anchor = document.querySelector('[data-coach="add-products"]');
      if (!anchor) {
        setPosition(null);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const left = Math.min(
        Math.max(rect.right - COACH_WIDTH, COACH_MARGIN),
        window.innerWidth - COACH_WIDTH - COACH_MARGIN
      );
      setPosition({
        top: rect.bottom + 10,
        left,
        arrowRight: Math.max(left + COACH_WIDTH - (rect.left + rect.width / 2) - 6, 12),
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { passive: true, capture: true });
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, { capture: true });
    };
  }, []);

  if (!position || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="status"
      className="fixed z-[70] rounded-2xl p-3 shadow-xl"
      style={{
        top: position.top,
        left: position.left,
        width: COACH_WIDTH,
        background: CARD,
        color: INK,
        border: `1px solid ${LINE}`,
      }}
    >
      <span
        aria-hidden="true"
        className="absolute h-3 w-3 rotate-45"
        style={{
          top: -6,
          right: position.arrowRight,
          background: CARD,
          borderLeft: `1px solid ${LINE}`,
          borderTop: `1px solid ${LINE}`,
        }}
      />
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 p-1"
        style={{ color: MUTED }}
      >
        <X className="h-4 w-4" />
      </button>
      <p className="pr-6 text-sm font-bold leading-5" style={{ color: INK }}>
        Click here to add your products
      </p>
      <button
        type="button"
        onClick={onLearn}
        className="mt-1 text-[13px] font-bold underline"
        style={{ color: INK }}
      >
        Learn how to add
      </button>
    </div>,
    document.body
  );
}
