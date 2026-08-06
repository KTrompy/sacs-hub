// Square business logo with an initials fallback, used by the Business
// Directory cards, the business detail page, and the "Businesses near me"
// widget on Home.
//
// Lives in its own file rather than inside BusinessDirectory.jsx because Home
// needs it: a single named import from BusinessDirectory pulled that whole
// 40 kB module — filters, forms, map, the lot — into the initial bundle, which
// defeated the lazy route split in App.jsx entirely. Vite says as much at
// build time ("dynamically imported ... but also statically imported ...,
// dynamic import will not move module into another chunk").
export function BusinessLogo({ url, name }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase()
  return url ? (
    <img className="job-logo" src={url} alt={name ? `${name} logo` : 'Business logo'} loading="lazy" />
  ) : (
    <div className="job-logo job-logo-fallback" aria-hidden="true">{initial}</div>
  )
}

export default BusinessLogo
