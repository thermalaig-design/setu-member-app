import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { parseLegalSections } from '../utils/legalContent';

const TermsModal = ({ isOpen, onAccept, content = '', trustName = '', loading = false, error = '' }) => {
  if (!isOpen) return null;

  const sections = parseLegalSections(content);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 w-full max-w-[430px] left-1/2 -translate-x-1/2"
      style={{ background: 'color-mix(in srgb, var(--body-text-color) 62%, transparent)' }}
    >
      <div
        className="w-full max-w-[420px] rounded-3xl shadow-2xl overflow-hidden max-h-[90vh]"
        style={{
          background: 'var(--surface-color)',
          border: '1px solid color-mix(in srgb, var(--body-text-color) 12%, var(--surface-color))',
          boxShadow: '0 24px 60px color-mix(in srgb, var(--body-text-color) 20%, transparent)'
        }}
      >
        <div
          className="p-6 text-center relative"
          style={{
            background: 'var(--app-button-bg)',
            color: 'var(--app-button-text)'
          }}
        >
          
          <h2 className=" flex align-center gap-[5px] md:gap-2 text-xl font-bold justify-center" style={{ color: 'var(--app-button-text)' }}><div
            className="w-10 h-10 rounded-full flex items-center justify-center "
            style={{ background: 'color-mix(in srgb, var(--surface-color) 18%, transparent)' }}
          >
            <ShieldCheck />
          </div><p className='mt-[5px]'> Terms & Conditions</p></h2>
          <p className="text-sm mt-1" style={{ color: 'color-mix(in srgb, var(--app-button-text) 72%, transparent)' }}>
            Please review and accept to continue
          </p>
          {/* {trustName ? (
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: 'color-mix(in srgb, var(--app-button-text) 82%, transparent)' }}>
              {trustName}
            </p>
          ) : null} */}
        </div>

        <div
          className="p-6 max-h-[58vh] overflow-y-auto overflow-x-hidden space-y-4 text-sm leading-relaxed"
          style={{ color: 'var(--body-text-color)' }}
        >
          {loading ? (
            <p style={{ color: 'var(--body-text-color)' }}>Loading terms...</p>
          ) : error ? (
            <p style={{ color: 'var(--brand-red-dark)' }}>{error}</p>
          ) : sections.length > 0 ? (
            sections.map((section, idx) => (
              <section key={idx} className="space-y-2">
                {section.isHtml ? (
                  <div style={{ color: 'var(--body-text-color)' }} dangerouslySetInnerHTML={{ __html: section.body }} />
                ) : section.num ? (
                  <>
                    <h3 className="font-bold" style={{ color: 'var(--heading-color)' }}>
                      {section.num}. {section.title}
                    </h3>
                    {section.body ? <p style={{ color: 'var(--body-text-color)' }}>{section.body}</p> : null}
                  </>
                ) : (
                  <p style={{ color: 'var(--body-text-color)' }}>{section.body}</p>
                )}
              </section>
            ))
          ) : (
            <p style={{ color: 'var(--body-text-color)' }}>Terms content is not available yet.</p>
          )}
        </div>

        <div className="p-6 border-t" style={{ borderColor: 'color-mix(in srgb, var(--body-text-color) 10%, var(--surface-color))' }}>
          <button
            type="button"
            onClick={onAccept}
            className="w-full font-bold py-4 rounded-2xl transition-all active:scale-[0.98]"
            style={{
              background: 'var(--app-button-bg)',
              color: 'var(--app-button-text)',
              boxShadow: '0 10px 22px color-mix(in srgb, var(--brand-red) 22%, transparent)'
            }}
          >
            I Accept
          </button>
          <p className="text-center text-xs mt-3" style={{ color: 'color-mix(in srgb, var(--body-text-color) 54%, var(--surface-color))' }}>
            Last updated: January 2026
          </p>
        </div>
      </div>
    </div>
  );
};

export default TermsModal;
