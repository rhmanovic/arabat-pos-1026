// Bundled by e2e/device.spec.ts and injected before the device page loads: a fake native bridge
// (in-memory SQLite, API calls to the test server with the device token, recorded prints).
// Relative: the test runner's root does not depend on the package.
import { createFakeBridge } from '../packages/device-core/src/testing/index.js';

declare global {
  interface Window {
    __arabatBridgeReady?: Promise<unknown>;
    __arabatPrinted?: () => string[];
  }
}

window.__arabatBridgeReady = createFakeBridge({ baseUrl: `${location.origin}/api/v1` }).then(
  (bridge) => {
    window.ArabatApp = bridge;
    window.__arabatPrinted = () => bridge.printed;
  },
);
