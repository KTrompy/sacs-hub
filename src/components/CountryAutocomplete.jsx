import ListAutocomplete from './ListAutocomplete.jsx'
import { COUNTRIES } from '../constants.js'

// Thin wrapper around ListAutocomplete for the world country list — kept as
// its own component since "which country" shows up in a few places
// (Onboarding, Profile) and reads more clearly than passing options around.
export default function CountryAutocomplete(props) {
  return <ListAutocomplete options={COUNTRIES} {...props} />
}
