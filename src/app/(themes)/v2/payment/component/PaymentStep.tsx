// File: src/app/(themes)/v2/payment/component/PaymentStep.tsx
// Description: Auto-added top comment for easier file identification.

'use client';
import { useState } from 'react';
import SharedPaymentContent from '@/components/flow/SharedPaymentContent';
import { usePaymentFlow } from '@/lib/hooks/usePaymentFlow';
import styles from '../../page.module.css';

export default function PaymentStep({
  price, paid: _paid, setPaid: _setPaid, errMsg: _errMsg, setErrMsg: _setErrMsg,
  captures, videos, templateId, compositedImage, onSuccess, onBack: _onBack,
}: {
  price: number; paid: boolean; setPaid: (v: boolean) => void;
  errMsg: string | null; setErrMsg: (v: string | null) => void;
  captures: string[]; videos: string[]; templateId: string; compositedImage: string | null;
  onSuccess: (id: string) => void; onBack: () => void;
}) {
  const paymentFlow = usePaymentFlow({ price, templateId, captures, videos, compositedImage, onSuccess });
  const [bypassing, setBypassing] = useState(false);

  const handleBypass = async () => {
    setBypassing(true);
    try { await paymentFlow.handleBypass(); } finally { setBypassing(false); }
  };

  return (
    <div className={styles.paymentLayout}>
      <div className={styles.paymentCard}>
        <SharedPaymentContent
          price={price}
          isPaid={paymentFlow.paid}
          isLoading={paymentFlow.loading}
          isSnapLoaded={paymentFlow.snapLoaded}
          hasSnapError={paymentFlow.snapError}
          errorMessage={paymentFlow.errMsg}
          paymentUrl={paymentFlow.paymentUrl}
          qrDataUrl={paymentFlow.qrDataUrl}
          onRetry={() => window.location.reload()}
          onBypass={handleBypass}
          isBypassing={bypassing}
          primaryButtonClassName={`${styles.boothBtn} ${styles.boothBtnPrimary}`}
          secondaryButtonClassName={styles.boothBtn}
          errorClassName={styles.errorMessage}
        />
      </div>
    </div>
  );
}
