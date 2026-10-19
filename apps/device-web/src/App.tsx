import { findBridge } from '@arabat/device-core';
import { Direction, ToastProvider } from '@arabat/ui';
import { useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { DeviceProvider, useDevice } from './app/device.js';
import { i18n } from './i18n/index.js';
import { LockScreen } from './screens/Lock.js';
import { RefundsScreen } from './screens/Refunds.js';
import { RegisterScreen } from './screens/Register.js';
import { SaleScreen } from './screens/Sale.js';
import { CloseShiftScreen, OpenShiftScreen } from './screens/Shift.js';
import { LanguageButton } from './screens/StatusBar.js';

function NotInApp() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-console p-6 text-center text-console-fg">
      <h1 className="text-2xl font-semibold">{t('notInApp.title')}</h1>
      <p className="max-w-md text-console-fg/80">{t('notInApp.body')}</p>
      <LanguageButton />
    </main>
  );
}

type View = 'sell' | 'refunds' | 'close';

/** One screen at a time, decided by the device's state: register → sign in → shift → sell. */
function Screens() {
  const { registered, cashier, shift, ctx } = useDevice();
  const [view, setView] = useState<View>('sell');
  if (!registered) return <RegisterScreen />;
  if (!cashier || !ctx) return <LockScreen />;
  // The closing screen stays up with its Z summary after the shift is gone.
  if (view === 'close') return <CloseShiftScreen onDone={() => setView('sell')} />;
  if (!shift || shift.membershipId !== cashier.membershipId) return <OpenShiftScreen />;
  if (view === 'refunds') return <RefundsScreen onBack={() => setView('sell')} />;
  return <SaleScreen onRefunds={() => setView('refunds')} onClose={() => setView('close')} />;
}

function DirectionRoot({ children }: { children: React.ReactNode }) {
  const { i18n: instance } = useTranslation();
  return <Direction.Provider dir={instance.dir(instance.language)}>{children}</Direction.Provider>;
}

export function App() {
  const bridge = findBridge();
  return (
    <I18nextProvider i18n={i18n}>
      <DirectionRoot>
        <ToastProvider placement="top-center">
          {bridge ? (
            <DeviceProvider bridge={bridge}>
              <Screens />
            </DeviceProvider>
          ) : (
            <NotInApp />
          )}
        </ToastProvider>
      </DirectionRoot>
    </I18nextProvider>
  );
}
