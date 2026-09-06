/* Minimal hand-drawn line icons for the sidebar, matching the rest of the
   app's convention (inline SVG, currentColor, no icon font/library). Kept
   deliberately plain — 18x18, 1.6 stroke — so a row of eleven of them reads
   as calm wayfinding, not decoration. */
const base = { viewBox: '0 0 24 24', width: 17, height: 17, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }

export const OverviewIcon = () => (<svg {...base}><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" /><rect x="13" y="3.5" width="7.5" height="4.5" rx="1.5" /><rect x="13" y="10" width="7.5" height="10.5" rx="1.5" /><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" /></svg>)
export const PendingIcon = () => (<svg {...base}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>)
export const MembersIcon = () => (<svg {...base}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c0-3.6 2.5-6 5.5-6s5.5 2.4 5.5 6" /><circle cx="17" cy="8.5" r="2.4" /><path d="M15.5 12.3c2.3.3 4 2.4 4 5.2" /></svg>)
export const ReportsIcon = () => (<svg {...base}><path d="M5 3.5v17" /><path d="M5 4.5c2-1 4-1 6 0s4 1 6 0v8c-2 1-4 1-6 0s-4-1-6 0z" /></svg>)
export const PostsIcon = () => (<svg {...base}><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M8 8.5h8M8 12.5h8M8 16.5h5" /></svg>)
export const JobsIcon = () => (<svg {...base}><rect x="3.5" y="7.5" width="17" height="12" rx="2" /><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" /><path d="M3.5 12.5h17" /></svg>)
export const EventsIcon = () => (<svg {...base}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17" /><path d="M8 3v3.5M16 3v3.5" /></svg>)
export const BusinessesIcon = () => (<svg {...base}><path d="M4 9.5L12 4l8 5.5" /><rect x="5.5" y="9.5" width="13" height="10.5" rx="1" /><path d="M10 20v-5a2 2 0 0 1 4 0v5" /></svg>)
export const OrdersIcon = () => (<svg {...base}><path d="M4 6h16l-1.5 9.5a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7L4 6z" /><path d="M8.5 6a3.5 3.5 0 0 1 7 0" /></svg>)
export const ProductsIcon = () => (<svg {...base}><path d="M3.5 8l8.5-4.5L20.5 8v8L12 20.5 3.5 16z" /><path d="M3.5 8L12 12.5 20.5 8" /><path d="M12 12.5V20.5" /></svg>)
export const LegendsIcon = () => (<svg {...base}><path d="M12 3.5l2.6 5.4 5.9.7-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.7z" /></svg>)
export const ActivityIcon = () => (<svg {...base}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></svg>)
export const HandbookIcon = () => (<svg {...base}><path d="M5 4.5c2.2-1 4.6-1 6.8 0v14.8c-2.2-1-4.6-1-6.8 0z" /><path d="M18.8 4.5c-2.2-1-4.6-1-6.8 0v14.8c2.2-1 4.6-1 6.8 0z" /></svg>)
export const SearchIcon = () => (<svg {...base} width="15" height="15"><circle cx="10.5" cy="10.5" r="6" /><path d="M19 19l-4-4" /></svg>)
export const MenuIcon = () => (<svg {...base}><path d="M4 6.5h16M4 12h16M4 17.5h16" /></svg>)
export const ChevronDown = () => (<svg {...base} width="12" height="12"><path d="M5 8.5l5 5 5-5" /></svg>)
