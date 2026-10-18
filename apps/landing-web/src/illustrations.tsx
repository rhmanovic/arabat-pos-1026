import type { OfferItemIcon } from '@arabat/contracts';
import type { ReactNode } from 'react';

/**
 * Flat drawings of the offer items in the brand colours, shown until the operator uploads a
 * photo in the platform console (ADR-0114).
 */
export function ItemIllustration({
  icon,
  className = '',
}: {
  icon: OfferItemIcon;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <circle cx="60" cy="60" r="56" fill="#e6f4f3" />
      {DRAWINGS[icon]}
    </svg>
  );
}

const DRAWINGS: Record<OfferItemIcon, ReactNode> = {
  system: (
    <g>
      <rect x="22" y="30" width="76" height="50" rx="6" fill="#36363f" />
      <rect x="27" y="35" width="66" height="40" rx="3" fill="#fff" />
      <rect x="33" y="58" width="8" height="12" rx="1.5" fill="#339a96" opacity=".45" />
      <rect x="45" y="52" width="8" height="18" rx="1.5" fill="#339a96" opacity=".6" />
      <rect x="57" y="47" width="8" height="23" rx="1.5" fill="#339a96" opacity=".8" />
      <rect x="69" y="41" width="8" height="29" rx="1.5" fill="#339a96" />
      <circle cx="84" cy="44" r="4" fill="#f07434" />
      <rect x="54" y="80" width="12" height="9" fill="#36363f" />
      <rect x="42" y="88" width="36" height="5" rx="2.5" fill="#36363f" />
    </g>
  ),
  tablet: (
    <g>
      <rect x="18" y="34" width="84" height="54" rx="8" fill="#36363f" />
      <rect x="24" y="40" width="72" height="42" rx="3" fill="#fff" />
      <rect x="29" y="45" width="18" height="14" rx="2" fill="#339a96" opacity=".25" />
      <rect x="51" y="45" width="18" height="14" rx="2" fill="#339a96" opacity=".25" />
      <rect x="29" y="63" width="18" height="14" rx="2" fill="#339a96" opacity=".25" />
      <rect x="51" y="63" width="18" height="14" rx="2" fill="#339a96" opacity=".25" />
      <rect x="73" y="45" width="18" height="32" rx="2" fill="#339a96" />
      <rect x="76" y="70" width="12" height="4" rx="2" fill="#fff" />
    </g>
  ),
  ipad: (
    <g>
      <rect x="34" y="18" width="52" height="84" rx="8" fill="#9ca3af" />
      <rect x="37" y="21" width="46" height="78" rx="6" fill="#36363f" />
      <rect x="40" y="27" width="40" height="64" rx="3" fill="#fff" />
      <rect x="44" y="32" width="32" height="8" rx="2" fill="#339a96" />
      <rect x="44" y="44" width="14" height="12" rx="2" fill="#339a96" opacity=".3" />
      <rect x="62" y="44" width="14" height="12" rx="2" fill="#339a96" opacity=".3" />
      <rect x="44" y="60" width="14" height="12" rx="2" fill="#f07434" opacity=".5" />
      <rect x="62" y="60" width="14" height="12" rx="2" fill="#339a96" opacity=".3" />
      <rect x="44" y="77" width="32" height="8" rx="4" fill="#339a96" />
      <circle cx="60" cy="95" r="1.6" fill="#9ca3af" />
    </g>
  ),
  scanner: (
    <g>
      <path
        d="M30 40h46a10 10 0 0 1 10 10v4a10 10 0 0 1-10 10H60l-8 30a5 5 0 0 1-5 4h-6a4 4 0 0 1-4-5l7-29H30a6 6 0 0 1-6-6V46a6 6 0 0 1 6-6Z"
        fill="#36363f"
      />
      <rect x="78" y="44" width="6" height="16" rx="2" fill="#d45858" />
      <path
        d="M86 47 104 38M86 52h20M86 57l18 9"
        stroke="#d45858"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".7"
      />
      <rect x="34" y="47" width="30" height="4" rx="2" fill="#339a96" />
    </g>
  ),
  printer: (
    <g>
      <path d="M44 22h32v34H44z" fill="#fff" stroke="#d1d5db" strokeWidth="2" />
      <path
        d="M49 30h22M49 36h16M49 42h22M49 48h12"
        stroke="#9ca3af"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect x="26" y="52" width="68" height="40" rx="8" fill="#36363f" />
      <rect x="36" y="50" width="48" height="6" rx="3" fill="#1f2937" />
      <circle cx="80" cy="66" r="3.5" fill="#339a96" />
      <rect x="34" y="76" width="30" height="5" rx="2.5" fill="#4b5563" />
    </g>
  ),
  drawer: (
    <g>
      <rect x="18" y="48" width="84" height="44" rx="6" fill="#36363f" />
      <path d="M24 48 30 36h60l6 12" fill="#4b5563" />
      <rect x="30" y="38" width="12" height="9" rx="1.5" fill="#339a96" />
      <rect x="45" y="38" width="12" height="9" rx="1.5" fill="#339a96" opacity=".8" />
      <rect x="60" y="38" width="12" height="9" rx="1.5" fill="#339a96" opacity=".6" />
      <circle cx="80" cy="42" r="4" fill="#f5b942" />
      <circle cx="88" cy="43" r="3.5" fill="#f5b942" opacity=".85" />
      <rect x="44" y="64" width="32" height="6" rx="3" fill="#9ca3af" />
      <circle cx="90" cy="82" r="3" fill="#f07434" />
    </g>
  ),
  other: (
    <g>
      <path d="M60 24 94 40v40L60 96 26 80V40z" fill="#36363f" />
      <path d="M60 24 94 40 60 56 26 40z" fill="#4b5563" />
      <path d="M60 56v40" stroke="#1f2937" strokeWidth="2" />
      <path d="m43 32 34 16v10" stroke="#339a96" strokeWidth="5" fill="none" />
    </g>
  ),
};
