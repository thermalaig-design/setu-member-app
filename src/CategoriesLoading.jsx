import React from "react";
import "./CategoriesLoading.css";

/**
 * Loading state for the Categories page.
 * Render this between your existing header and footer while the
 * categories RPC is in flight.
 *
 * Usage:
 *   {status === "loading" && <CategoriesLoading />}
 */

const CIRCLE_COUNT = 5;
const TILE_LABEL_WIDTHS = ["78%", "60%", "72%", "56%", "82%", "64%"];

export default function CategoriesLoading({
  title = "Loading your store",
  subtitle = "This will only take a moment",
}) {
  return (
    <div
      className="cl-root"
      role="status"
      aria-live="polite"
      aria-label="Loading categories"
    >
      {/* Skeleton behind the loader */}
      <div className="cl-skeleton" aria-hidden="true">
        <div className="cl-circles">
          {Array.from({ length: CIRCLE_COUNT }).map((_, i) => (
            <div className="cl-circle-item" key={i}>
              <div className="cl-sk cl-circle" />
              <div className="cl-sk cl-line" style={{ width: 56 }} />
            </div>
          ))}
        </div>

        <div className="cl-sk cl-heading" />

        <div className="cl-grid">
          {TILE_LABEL_WIDTHS.map((w, i) => (
            <div className="cl-tile" key={i}>
              <div className="cl-sk cl-tile-img" />
              <div className="cl-sk cl-line" style={{ width: w }} />
            </div>
          ))}
        </div>

        <div className="cl-banners">
          <div className="cl-sk cl-banner" />
          <div className="cl-sk cl-banner" />
        </div>
      </div>

      {/* Soft veil so the loader stands out */}
      <div className="cl-veil" aria-hidden="true" />

      {/* Centered loader */}
      <div className="cl-center">
        <div className="cl-card">
          <div className="cl-spinner" aria-hidden="true">
            <svg width="56" height="56" viewBox="0 0 56 56" className="cl-track">
              <circle cx="28" cy="28" r="23" />
            </svg>
            <svg width="56" height="56" viewBox="0 0 56 56" className="cl-rotor">
              <circle cx="28" cy="28" r="23" className="cl-arc" />
            </svg>
          </div>
        </div>
        <div className="cl-text">
          <div className="cl-title">{title}</div>
          <div className="cl-subtitle">{subtitle}</div>
        </div>
      </div>
    </div>
  );
}