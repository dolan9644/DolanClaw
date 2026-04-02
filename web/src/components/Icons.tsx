/**
 * DolanClaw — SVG Icon System
 * Clean, monochrome icons replacing emoji for premium UI feel.
 * All icons: 16×16, stroke-based, currentColor.
 */

interface IconProps {
  size?: number
  className?: string
}

const s = (props: IconProps) => ({
  width: props.size || 16,
  height: props.size || 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: props.className,
})

// ─── Sidebar Navigation ──────────────────────────────────

export function IconChat(p: IconProps = {}) {
  return <svg {...s(p)}><path d="M2.5 3A1.5 1.5 0 0 1 4 1.5h8A1.5 1.5 0 0 1 13.5 3v6A1.5 1.5 0 0 1 12 10.5H5.5L2.5 13.5V3z"/></svg>
}

export function IconDashboard(p: IconProps = {}) {
  return <svg {...s(p)}><rect x="1.5" y="1.5" width="5" height="5" rx="1"/><rect x="9.5" y="1.5" width="5" height="5" rx="1"/><rect x="1.5" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/></svg>
}

export function IconFolder(p: IconProps = {}) {
  return <svg {...s(p)}><path d="M1.5 3.5a1 1 0 0 1 1-1h3l1.5 1.5h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8.5z"/></svg>
}

export function IconDiff(p: IconProps = {}) {
  return <svg {...s(p)}><path d="M8 1.5v13M3.5 5.5h9M3.5 10.5h9"/></svg>
}

export function IconTasks(p: IconProps = {}) {
  return <svg {...s(p)}><rect x="1.5" y="1.5" width="13" height="13" rx="2"/><path d="M5 8l2 2 4-4"/></svg>
}

export function IconMemory(p: IconProps = {}) {
  return <svg {...s(p)}><circle cx="8" cy="8" r="3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>
}

export function IconPlug(p: IconProps = {}) {
  return <svg {...s(p)}><path d="M5.5 1.5v4M10.5 1.5v4M3.5 5.5h9v2a5 5 0 0 1-4.5 5 5 5 0 0 1-4.5-5v-2z"/></svg>
}

export function IconPuzzle(p: IconProps = {}) {
  return <svg {...s(p)}><path d="M5 2.5h6a1 1 0 0 1 1 1v2.5h-1a1.5 1.5 0 1 0 0 3h1V12a1 1 0 0 1-1 1H8.5v-1a1.5 1.5 0 1 0-3 0v1H3.5a1 1 0 0 1-1-1V9h1a1.5 1.5 0 1 0 0-3h-1V3.5a1 1 0 0 1 1-1z"/></svg>
}

export function IconWrench(p: IconProps = {}) {
  return <svg {...s(p)}><path d="M10.5 2a4 4 0 0 0-3.8 5.2L2.5 11.5v2h2l4.3-4.2A4 4 0 1 0 10.5 2z"/></svg>
}

export function IconStore(p: IconProps = {}) {
  return <svg {...s(p)}><path d="M2 6.5L3.5 2.5h9L14 6.5"/><path d="M2 6.5c0 1.1.9 2 2 2s2-.9 2-2c0 1.1.9 2 2 2s2-.9 2-2c0 1.1.9 2 2 2s2-.9 2-2"/><path d="M2.5 8.5v5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-5"/></svg>
}

export function IconBot(p: IconProps = {}) {
  return <svg {...s(p)}><rect x="2.5" y="4.5" width="11" height="9" rx="2"/><circle cx="5.5" cy="8.5" r="1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="8.5" r="1" fill="currentColor" stroke="none"/><path d="M8 1.5v3M5.5 2.5h5"/></svg>
}

export function IconShield(p: IconProps = {}) {
  return <svg {...s(p)}><path d="M8 1.5L2.5 4v4c0 3.5 2.5 5.5 5.5 6.5 3-1 5.5-3 5.5-6.5V4L8 1.5z"/></svg>
}

export function IconSessions(p: IconProps = {}) {
  return <svg {...s(p)}><path d="M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM11.5 9.5v4"/><path d="M9.5 11.5h4"/></svg>
}

export function IconSettings(p: IconProps = {}) {
  return <svg {...s(p)}><circle cx="8" cy="8" r="2.5"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 3l1 1"/></svg>
}

// ─── App-level Icons ─────────────────────────────────────

export function IconCheck(p: IconProps = {}) {
  return <svg {...s(p)}><path d="M3.5 8.5l3 3 6-7"/></svg>
}

export function IconX(p: IconProps = {}) {
  return <svg {...s(p)}><path d="M4 4l8 8M12 4l-8 8"/></svg>
}

export function IconAlert(p: IconProps = {}) {
  return <svg {...s(p)}><path d="M8 1.5l6.5 12H1.5L8 1.5z"/><path d="M8 6.5v3M8 11.5v.5"/></svg>
}

export function IconInfo(p: IconProps = {}) {
  return <svg {...s(p)}><circle cx="8" cy="8" r="6.5"/><path d="M8 7v4M8 5v.5"/></svg>
}

export function IconCopy(p: IconProps = {}) {
  return <svg {...s(p)}><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M2.5 10.5V3a1.5 1.5 0 0 1 1.5-1.5h7.5"/></svg>
}

export function IconFile(p: IconProps = {}) {
  return <svg {...s(p)}><path d="M3.5 1.5h6l3 3v9a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z"/><path d="M9.5 1.5v3h3"/></svg>
}

export function IconMenu(p: IconProps = {}) {
  return <svg {...s(p)}><path d="M2 4h12M2 8h12M2 12h12"/></svg>
}
