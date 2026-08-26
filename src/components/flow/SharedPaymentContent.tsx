// File: src/components/flow/SharedPaymentContent.tsx
// Description: Auto-added top comment for easier file identification.

'use client';

import { Loader2 } from 'lucide-react';
import type { CSSProperties } from 'react';

interface SharedPaymentContentProps {
  price: number;
  isPaid: boolean;
  isLoading: boolean;
  isSnapLoaded: boolean;
  hasSnapError: boolean;
  errorMessage: string | null;
  paymentUrl?: string | null;
  qrDataUrl?: string | null;
  onRetry: () => void;
  onBypass: () => Promise<void>;
  isBypassing?: boolean;
  primaryButtonClassName?: string;
  secondaryButtonClassName?: string;
  errorClassName?: string;
  containerStyle?: CSSProperties;
}

// Shared payment content encapsulates QRIS payment UI, loading state, and error handling.
export default function SharedPaymentContent({
  price,
  isPaid,
  isLoading,
  isSnapLoaded: _isSnapLoaded,
  hasSnapError,
  errorMessage,
  paymentUrl,
  qrDataUrl,
  onRetry,
  onBypass,
  isBypassing = false,
  primaryButtonClassName,
  secondaryButtonClassName,
  errorClassName,
  containerStyle,
}: SharedPaymentContentProps) {
  return (
    <div style={containerStyle}>
      <h2 style={{ margin: '0 0 12px', textAlign: 'center' }}>Payment</h2>
      <p style={{ color: '#888', marginBottom: 24 }}>Scan the QRIS code to pay</p>

      {isPaid ? (
        <div>
          <Loader2 size={48} className="spin" style={{ color: '#262626' }} />
          <p>Waiting for Payment...</p>
          {errorMessage ? <p className={errorClassName}>{errorMessage}</p> : null}
        </div>
      ) : (
        <>
          {qrDataUrl ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <a href={paymentUrl || '#'} target="_blank" rel="noopener">
                <img src={qrDataUrl} alt="QRIS payment code" style={{ width: 220, height: 220, background: '#fff', padding: 8, borderRadius: 8 }} />
              </a>
              <p style={{ color: '#888', fontSize: 12, margin: 0, textAlign: 'center' }}>
                Scan untuk buka halaman pembayaran
              </p>
              {paymentUrl && (
                <a href={paymentUrl} target="_blank" rel="noopener" className={primaryButtonClassName} style={{ textDecoration: 'none' }}>
                  Buka Halaman Bayar
                </a>
              )}
            </div>
          ) : paymentUrl ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <a href={paymentUrl} target="_blank" rel="noopener" className={primaryButtonClassName} style={{ textDecoration: 'none' }}>
                Bayar Sekarang (QRIS)
              </a>
              <p style={{ color: '#888', fontSize: 12, margin: 0, textAlign: 'center' }}>Membuka QR...</p>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 180, marginBottom: 18 }}>
              <Loader2 size={48} className="spin" />
            </div>
          )}
          <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center' }}>Rp {price.toLocaleString('id-ID')}</div>
          {errorMessage && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <p className={errorClassName}>{errorMessage}</p>
              <button className={primaryButtonClassName} onClick={onRetry} style={{ marginTop: 12 }}>Retry Payment</button>
            </div>
          )}
          {!errorMessage && hasSnapError && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <p className={errorClassName}>Payment gateway failed to load. Check your connection.</p>
              <button className={primaryButtonClassName} onClick={onRetry} style={{ marginTop: 12 }}>Retry</button>
            </div>
          )}
          {!errorMessage && !hasSnapError && isLoading && !qrDataUrl && (
            <p style={{ color: '#888', fontSize: 13, marginTop: 12, textAlign: 'center' }}>
              Generating payment link...
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24, opacity: isBypassing ? 1 : 0.5 }}>
            <button
              className={secondaryButtonClassName}
              onClick={onBypass}
              disabled={isPaid || isBypassing}
              style={{ background: 'none', border: '1px dashed #666', padding: '4px 12px', fontSize: 11, color: '#888', cursor: isBypassing ? 'default' : 'pointer' }}
            >
              {isBypassing ? 'Processing...' : 'Bypass Payment (testing)'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
