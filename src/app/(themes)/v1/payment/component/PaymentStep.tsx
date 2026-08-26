// File: src/app/(themes)/v1/payment/component/PaymentStep.tsx
// Description: Auto-added top comment for easier file identification.

'use client';
import { useState } from 'react';
import StepperBar from '../../StepperBar';
import SharedPaymentContent from '@/components/flow/SharedPaymentContent';
import { usePaymentFlow } from '@/lib/hooks/usePaymentFlow';
import styles from '@/app/(themes)/v1/page.module.css';

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
  const [isBypassing, setIsBypassing] = useState(false);

  const handleBypass = async () => {
    setIsBypassing(true);
    try {
      await paymentFlow.handleBypass();
    } finally {
      setIsBypassing(false);
    }
  };

  return (
    <>
      <div className={styles.templateStepper}><StepperBar current={3} total={5} /></div>
      <div className={`${styles.stepPage} ${styles.stepPagePayment}`}>
        <div className={styles.stepHeader}>
          <span />
          <h1 className={styles.stepHeading}>Pembayaran</h1>
        </div>
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
          isBypassing={isBypassing}
          primaryButtonClassName={styles.boothBtnPrimary}
          secondaryButtonClassName={styles.boothBtnSecondary}
          errorClassName={styles.paymentError}
          containerStyle={{ padding: 0, margin: 0 }}
        />
        </div>
      </div>
    </>
  );
}
