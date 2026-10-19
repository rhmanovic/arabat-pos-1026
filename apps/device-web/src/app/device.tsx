import { POS_IDLE_LOCK_SECONDS } from '@arabat/contracts';
import {
  type ArabatBridge,
  type Cart,
  type Catalog,
  type DeviceInfo,
  type DevicePaymentMethod,
  EMPTY_CART,
  type LocalContext,
  type LocalShift,
  type OfflineState,
  type PrinterStatus,
  type StaffMember,
  SyncEngine,
  type SyncStatus,
  loadCatalog,
  loadContext,
  loadPaymentMethods,
  loadStaff,
  migrate,
  offlineState,
  openShiftOf,
} from '@arabat/device-core';
import { PosRuleError } from '@arabat/pos-core';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

/** Everything the screens read: local data, sync state, who is signed in, the open shift. */
export interface DeviceState {
  bridge: ArabatBridge;
  info: DeviceInfo | null;
  registered: boolean;
  ctx: LocalContext | null;
  staff: StaffMember[];
  catalog: Catalog | null;
  methods: DevicePaymentMethod[];
  shift: LocalShift | null;
  sync: SyncStatus;
  printer: PrinterStatus | null;
  updateReady: string | null;
  cashier: StaffMember | null;
  cart: Cart;
  /** Re-reads the local database after a write (snapshot, shift, sale). */
  reload: () => Promise<void>;
  syncNow: () => Promise<void>;
  requestUpload: () => void;
  setRegistered: (v: boolean) => void;
  signIn: (member: StaffMember) => void;
  lock: () => void;
  setCart: (cart: Cart) => void;
  applyUpdate: () => Promise<void>;
  offline: OfflineState;
  /** Selling is possible: synced within the limit, not revoked, not suspended. */
  canSell: boolean;
}

const DeviceContext = createContext<DeviceState | null>(null);

export function useDevice(): DeviceState {
  const value = useContext(DeviceContext);
  if (!value) throw new Error('useDevice outside DeviceProvider');
  return value;
}

export function DeviceProvider({
  bridge,
  children,
}: {
  bridge: ArabatBridge;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [registered, setRegistered] = useState(false);
  const [ctx, setCtx] = useState<LocalContext | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [methods, setMethods] = useState<DevicePaymentMethod[]>([]);
  const [shift, setShift] = useState<LocalShift | null>(null);
  const [printer, setPrinter] = useState<PrinterStatus | null>(null);
  const [updateReady, setUpdateReady] = useState<string | null>(null);
  const [cashier, setCashier] = useState<StaffMember | null>(null);
  const [cart, setCart] = useState<Cart>(EMPTY_CART);
  const [engine] = useState(
    () => new SyncEngine(bridge, bridge.db, { log: (m) => void bridge.app.log(m) }),
  );
  const [sync, setSync] = useState<SyncStatus>(engine.current);
  const [tick, setTick] = useState(0);

  const reload = useCallback(async () => {
    const [c, s, cat, m, sh] = await Promise.all([
      loadContext(bridge.db),
      loadStaff(bridge.db),
      loadCatalog(bridge.db),
      loadPaymentMethods(bridge.db),
      openShiftOf(bridge.db),
    ]);
    setCtx(c);
    setStaff(s);
    setCatalog(cat);
    setMethods(m);
    setShift(sh);
  }, [bridge]);

  // Start: schema, device info, registration state, local data, then the sync schedule.
  useEffect(() => {
    let stopped = false;
    void (async () => {
      await migrate(bridge.db);
      const [i, r] = await Promise.all([bridge.device.info(), bridge.api.isRegistered()]);
      if (stopped) return;
      setInfo(i);
      setRegistered(r);
      await reload();
      setReady(true);
      if (r) engine.start();
    })();
    let wasSyncing = false;
    const unsubscribe = engine.subscribe((status) => {
      setSync(status);
      // Each finished sync may have changed staff, prices or the shift's acceptance.
      if (wasSyncing && !status.syncing) void reload();
      wasSyncing = status.syncing;
    });
    bridge.printer.status().then(setPrinter, () => setPrinter(null));
    const onPrinter = (e: Event) => setPrinter((e as CustomEvent<PrinterStatus>).detail);
    const onUpdate = (e: Event) =>
      setUpdateReady((e as CustomEvent<{ version: string }>).detail?.version ?? 'new');
    window.addEventListener('arabat:printer', onPrinter);
    window.addEventListener('arabat:update-ready', onUpdate);
    // The offline level is a function of time: re-evaluate every minute.
    const clock = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => {
      stopped = true;
      unsubscribe();
      engine.stop();
      window.removeEventListener('arabat:printer', onPrinter);
      window.removeEventListener('arabat:update-ready', onUpdate);
      clearInterval(clock);
    };
  }, [bridge, engine, reload]);

  // Registration from the register screen starts the schedule.
  useEffect(() => {
    if (ready && registered) engine.start();
  }, [ready, registered, engine]);

  // A new bundle is applied at a safe moment: nobody signed in or an empty cart.
  const applyUpdate = useCallback(async () => {
    await bridge.app.applyUpdate();
  }, [bridge]);
  useEffect(() => {
    if (updateReady && cart.lines.length === 0 && !cashier) void applyUpdate();
  }, [updateReady, cart.lines.length, cashier, applyUpdate]);

  // Idle lock: no touch, mouse or keyboard input for POS_IDLE_LOCK_SECONDS.
  const last = useRef(0);
  useEffect(() => {
    if (!cashier) return;
    last.current = Date.now();
    const seen = () => {
      last.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    for (const e of events) window.addEventListener(e, seen, { passive: true });
    const id = setInterval(() => {
      if (Date.now() - last.current >= POS_IDLE_LOCK_SECONDS * 1000) setCashier(null);
    }, 10_000);
    return () => {
      for (const e of events) window.removeEventListener(e, seen);
      clearInterval(id);
    };
  }, [cashier]);

  // A signed-in person who left the staff list (deactivated, moved) is signed out.
  const activeCashier =
    cashier && staff.some((s) => s.membershipId === cashier.membershipId) ? cashier : null;

  const offline = useMemo(
    () => offlineState(ctx?.lastSuccessfulSyncAt ?? null, ctx?.offlineLimitHours ?? 72),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` re-evaluates the clock
    [ctx?.lastSuccessfulSyncAt, ctx?.offlineLimitHours, tick],
  );

  const value = useMemo<DeviceState>(
    () => ({
      bridge,
      info,
      registered,
      ctx,
      staff,
      catalog,
      methods,
      shift,
      sync,
      printer,
      updateReady,
      cashier: activeCashier,
      cart,
      reload,
      syncNow: () => engine.syncNow(),
      requestUpload: () => engine.requestUpload(),
      setRegistered,
      signIn: setCashier,
      lock: () => setCashier(null),
      setCart,
      applyUpdate,
      offline,
      canSell: offline.canSell && !sync.revoked && !sync.suspended,
    }),
    [
      bridge,
      info,
      registered,
      ctx,
      staff,
      catalog,
      methods,
      shift,
      sync,
      printer,
      updateReady,
      activeCashier,
      cart,
      reload,
      engine,
      applyUpdate,
      offline,
    ],
  );

  if (!ready) return <Splash />;
  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

function Splash() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-console text-console-fg">
      <p className="text-lg">{t('loading')}</p>
    </main>
  );
}

/** A refusal's code and message for the screen (pos-core rule, bridge error or server problem). */
export function describeError(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (error instanceof PosRuleError) {
    const known = t(`errors.${error.code}`, { defaultValue: '' });
    return known || error.message;
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = message.split(':')[0]!.trim();
  const known = t(`errors.${code}`, { defaultValue: '' });
  return known
    ? message.includes(':')
      ? `${known} ${message.slice(code.length + 1).trim()}`
      : known
    : message || t('errors.unknown');
}
