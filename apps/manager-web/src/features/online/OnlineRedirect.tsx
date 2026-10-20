import { FullPageLoader } from '@arabat/web-core';
import { useEffect } from 'react';
import { NAV } from '../../app/navigation.js';

/** The online store has its own console at /online (ADR-0119); old links land there. */
export function OnlineRedirect() {
  const to = NAV.find((n) => n.key === 'online')?.to ?? '/online/';
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return <FullPageLoader />;
}
