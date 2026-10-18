import type { TrialStarted } from '@arabat/contracts';
import { CONTACT_EMAIL, type Content } from './content.js';
import { primaryButton } from './layout.js';

/** Shared by the free-trial funnel (/start) and the pricing page, which both open trial accounts. */
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

/** Anonymous id of this visit, so the funnel counts steps without personal data. */
export function trialSessionId(): string {
  const make = () => crypto.randomUUID();
  try {
    const saved = sessionStorage.getItem('arabat.funnel');
    if (saved) return saved;
    const id = make();
    sessionStorage.setItem('arabat.funnel', id);
    return id;
  } catch {
    return make();
  }
}

export async function postTrial<T>(
  path: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; status: number; code?: string; issue?: string }> {
  try {
    const response = await fetch(`/api/v1/public/trial/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok)
      return { ok: true, data: (response.status === 204 ? null : await response.json()) as T };
    const problem = (await response.json().catch(() => null)) as {
      code?: string;
      issues?: { code?: string }[];
    } | null;
    return {
      ok: false,
      status: response.status,
      ...(problem?.code ? { code: problem.code } : {}),
      ...(problem?.issues?.[0]?.code ? { issue: problem.issues[0].code } : {}),
    };
  } catch {
    return { ok: false, status: 0 };
  }
}

export function TrialDone({ t, result }: { t: Content; result: TrialStarted }) {
  const d = t.start.done;
  return (
    <div className="step-in mx-auto max-w-2xl rounded-3xl bg-white p-8 text-center shadow-sm sm:p-12">
      <span className="pop mx-auto grid size-20 place-items-center rounded-full bg-brand text-4xl text-white shadow-lg shadow-brand/30">
        ✓
      </span>
      <h1 className="mt-6 text-3xl font-bold">
        {fill(d.title, { length: t.trialLength(result.trialDays) })}
      </h1>
      {result.devices !== 'none' ? (
        <p className="mt-3 text-lg leading-relaxed text-muted">
          {result.devices === 'waitlist' ? d.waitlist : d.devices}
        </p>
      ) : null}
      <a href={result.redirectTo} className={`${primaryButton} mt-8`}>
        {d.enter}
      </a>
      <p className="mt-6 text-sm text-muted">
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand" dir="ltr">
          {CONTACT_EMAIL}
        </a>
      </p>
    </div>
  );
}
