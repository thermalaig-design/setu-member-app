import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

export const DATE_FILTER_ALL = { preset: 'all', from: '', to: '' };

const PRESETS = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'custom', label: 'Pick dates' },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (value) => String(value).padStart(2, '0');
export const toDateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromDateKey = (key) => new Date(`${key}T00:00:00`);
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date, amount) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);

const formatKey = (key) => (key
  ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(fromDateKey(key))
  : 'Select');

// Resolves a filter value to inclusive { from, to } day keys ('' = unbounded).
export const resolveDateRange = (value) => {
  const today = startOfDay(new Date());
  switch (value?.preset) {
    case 'today':
      return { from: toDateKey(today), to: toDateKey(today) };
    case '7d':
      return { from: toDateKey(addDays(today, -6)), to: toDateKey(today) };
    case '30d':
      return { from: toDateKey(addDays(today, -29)), to: toDateKey(today) };
    case 'custom':
      return { from: value.from || '', to: value.to || '' };
    default:
      return { from: '', to: '' };
  }
};

function DateRangeSheet({ initialFrom, initialTo, onApply, onClear, onClose }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const todayKey = toDateKey(today);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [activeField, setActiveField] = useState(initialFrom && !initialTo ? 'to' : 'from');
  const [month, setMonth] = useState(() => {
    const anchor = initialFrom ? fromDateKey(initialFrom) : today;
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  });

  const isCurrentMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();

  const days = useMemo(() => {
    const firstWeekday = month.getDay();
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: firstWeekday }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => toDateKey(new Date(month.getFullYear(), month.getMonth(), index + 1))),
    ];
  }, [month]);

  const pickDay = (key) => {
    if (activeField === 'from' || !from || key < from) {
      setFrom(key);
      setTo('');
      setActiveField('to');
      return;
    }
    setTo(key);
    setActiveField('from');
  };

  const monthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(month);

  return (
    <div className="odf-overlay" onClick={onClose} role="presentation">
      <div
        className="odf-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Select dates"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="odf-handle" aria-hidden="true" />
        <div className="odf-sheet-head">
          <h2>Select dates</h2>
          <button type="button" className="odf-icon-btn" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="odf-fields">
          {[{ key: 'from', label: 'From', value: from }, { key: 'to', label: 'To', value: to }].map((field) => (
            <button
              key={field.key}
              type="button"
              className={`odf-field${activeField === field.key ? ' odf-field--active' : ''}`}
              onClick={() => setActiveField(field.key)}
            >
              <span>{field.label}</span>
              <strong>{formatKey(field.value)}</strong>
            </button>
          ))}
        </div>

        <div className="odf-month-row">
          <button
            type="button"
            className="odf-month-btn"
            onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <strong>{monthLabel}</strong>
          <button
            type="button"
            className="odf-month-btn"
            onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
            disabled={isCurrentMonth}
            aria-label="Next month"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="odf-grid" role="grid">
          {WEEKDAYS.map((weekday) => (
            <span key={weekday} className="odf-weekday">{weekday}</span>
          ))}
          {days.map((key, index) => {
            if (!key) return <span key={`blank-${index}`} />;

            const isFuture = key > todayKey;
            const isEdge = key === from || key === to;
            const inRange = from && to && key > from && key < to;
            const hasRange = Boolean(from && to && from !== to);
            const cellClass = [
              'odf-cell',
              inRange ? 'odf-cell--range' : '',
              hasRange && key === from ? 'odf-cell--start' : '',
              hasRange && key === to ? 'odf-cell--end' : '',
            ].filter(Boolean).join(' ');
            const dayClass = [
              'odf-day',
              isEdge ? 'odf-day--edge' : '',
              key === todayKey ? 'odf-day--today' : '',
            ].filter(Boolean).join(' ');

            return (
              <span key={key} className={cellClass}>
                <button
                  type="button"
                  className={dayClass}
                  disabled={isFuture}
                  onClick={() => pickDay(key)}
                  aria-pressed={isEdge}
                >
                  {Number(key.slice(8))}
                </button>
              </span>
            );
          })}
        </div>

        <div className="odf-actions">
          <button type="button" className="odf-btn" onClick={() => { setFrom(''); setTo(''); setActiveField('from'); onClear(); }}>
            Clear
          </button>
          <button
            type="button"
            className="odf-btn odf-btn--primary"
            disabled={!from}
            onClick={() => onApply({ preset: 'custom', from, to: to || from })}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

const OrderDateFilter = ({ value, onChange }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const rootRef = useRef(null);
  const isActive = value.preset !== 'all';

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const handlePointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setIsMenuOpen(false);
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') setIsMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('touchstart', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('touchstart', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isMenuOpen]);

  const selectPreset = (key) => {
    setIsMenuOpen(false);
    if (key === 'custom') {
      setIsSheetOpen(true);
      return;
    }
    onChange({ preset: key, from: '', to: '' });
  };

  return (
    <div className="odf-root" ref={rootRef}>
      <button
        type="button"
        className={`odf-trigger${isActive || isMenuOpen ? ' odf-trigger--active' : ''}`}
        onClick={() => setIsMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        aria-label="Filter by date"
      >
        <CalendarDays className="h-5 w-5" />
      </button>

      {isMenuOpen ? (
        <div className="odf-menu" role="menu">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              role="menuitemradio"
              aria-checked={value.preset === preset.key}
              className={`odf-menu-item${value.preset === preset.key ? ' odf-menu-item--active' : ''}`}
              onClick={() => selectPreset(preset.key)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}

      {isSheetOpen ? (
        <DateRangeSheet
          initialFrom={value.preset === 'custom' ? value.from : ''}
          initialTo={value.preset === 'custom' ? value.to : ''}
          onApply={(next) => { onChange(next); setIsSheetOpen(false); }}
          onClear={() => onChange(DATE_FILTER_ALL)}
          onClose={() => setIsSheetOpen(false)}
        />
      ) : null}

      <style>{`
        .odf-root {
          position: relative;
          margin-left: auto;
        }
        .odf-trigger {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 16%, transparent);
          background: var(--surface-color);
          color: var(--brand-navy);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .odf-trigger--active {
          background: var(--app-button-bg);
          border-color: var(--app-button-bg);
          color: var(--app-button-text);
        }
        .odf-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          z-index: 30;
          min-width: 190px;
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          border-radius: 18px;
          background: var(--surface-color);
          border: 1px solid color-mix(in srgb, var(--body-text-color) 10%, transparent);
          box-shadow: 0 18px 40px color-mix(in srgb, var(--brand-navy) 22%, transparent);
        }
        .odf-menu-item {
          min-height: 44px;
          padding: 0 14px;
          border: 0;
          border-radius: 12px;
          background: transparent;
          color: var(--heading-color);
          font-size: 14px;
          font-weight: 600;
          text-align: left;
          cursor: pointer;
        }
        .odf-menu-item--active {
          background: color-mix(in srgb, var(--brand-navy) 12%, var(--surface-color));
          color: var(--brand-navy);
          font-weight: 800;
        }
        .odf-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          background: color-mix(in srgb, var(--heading-color) 45%, transparent);
        }
        .odf-sheet {
          width: 100%;
          max-width: 400px;
          padding: 6px 16px calc(12px + env(safe-area-inset-bottom, 0px));
          border-radius: 20px 20px 0 0;
          background: var(--surface-color);
          color: var(--body-text-color);
        }
        .odf-handle {
          width: 44px;
          height: 5px;
          margin: 0 auto 4px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--body-text-color) 22%, transparent);
        }
        .odf-sheet-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .odf-sheet-head h2 {
          margin: 0;
          font-size: 16px;
          font-weight: 800;
          color: var(--heading-color);
        }
        .odf-icon-btn {
          width: 32px;
          height: 32px;
          border: 0;
          background: transparent;
          color: var(--heading-color);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .odf-fields {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .odf-field {
          padding: 6px 12px;
          border-radius: 12px;
          border: 1.5px solid color-mix(in srgb, var(--brand-navy) 18%, transparent);
          background: transparent;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
          text-align: left;
          cursor: pointer;
        }
        .odf-field span {
          font-size: 12px;
          color: color-mix(in srgb, var(--body-text-color) 64%, var(--surface-color));
        }
        .odf-field strong {
          font-size: 13px;
          font-weight: 800;
          color: var(--heading-color);
        }
        .odf-field--active {
          border-color: var(--brand-navy);
        }
        .odf-field--active span {
          color: var(--brand-navy);
        }
        .odf-month-row {
          margin: 10px 0 4px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: var(--heading-color);
          font-size: 15px;
        }
        .odf-month-btn {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 18%, transparent);
          background: transparent;
          color: var(--brand-navy);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .odf-month-btn:disabled {
          opacity: 0.35;
          cursor: default;
        }
        .odf-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          row-gap: 2px;
          text-align: center;
        }
        .odf-weekday {
          padding: 4px 0;
          font-size: 12px;
          font-weight: 600;
          color: color-mix(in srgb, var(--body-text-color) 64%, var(--surface-color));
        }
        .odf-cell {
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .odf-cell--range {
          background: color-mix(in srgb, var(--brand-navy) 12%, var(--surface-color));
        }
        .odf-cell--start {
          background: linear-gradient(90deg, transparent 50%, color-mix(in srgb, var(--brand-navy) 12%, var(--surface-color)) 50%);
        }
        .odf-cell--end {
          background: linear-gradient(90deg, color-mix(in srgb, var(--brand-navy) 12%, var(--surface-color)) 50%, transparent 50%);
        }
        .odf-day {
          width: 34px;
          height: 34px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: transparent;
          color: var(--heading-color);
          font-size: 14px;
          cursor: pointer;
        }
        .odf-day:disabled {
          color: color-mix(in srgb, var(--body-text-color) 28%, var(--surface-color));
          cursor: default;
        }
        .odf-day--today {
          font-weight: 800;
          color: var(--brand-navy);
        }
        .odf-day--edge {
          background: var(--app-button-bg);
          color: var(--app-button-text);
          font-weight: 800;
        }
        .odf-actions {
          margin-top: 10px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .odf-btn {
          min-height: 42px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 22%, transparent);
          background: transparent;
          color: var(--brand-navy);
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
        }
        .odf-btn--primary {
          border-color: var(--app-button-bg);
          background: var(--app-button-bg);
          color: var(--app-button-text);
        }
        .odf-btn--primary:disabled {
          opacity: 0.4;
          cursor: default;
        }
      `}</style>
    </div>
  );
};

export default OrderDateFilter;
