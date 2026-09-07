import { Route, Routes } from 'react-router-dom'
import MentorDirectory from './mentoring/MentorDirectory.jsx'
import MentorProfile from './mentoring/MentorProfile.jsx'

// Mentoring, rebuilt around one idea: mentors are Old Boys who've
// volunteered to help, you browse a directory to find someone relevant,
// and you email them directly. That's the whole product — no requests, no
// relationships, no sessions tracked in-app. See schema-update-65's header
// comment for what this replaced and why the old backend tables were left
// in place rather than dropped.
//
// Deliberately flat: two routes, no tabs, no settings page. The previous
// Overview/Discover/Relationships/Profile system (and everything under
// components/mentoring/ that isn't imported here — data.js, PersonSheet.jsx,
// OnboardingWizard.jsx, Overview.jsx, Discover.jsx, Relationships.jsx,
// Workspace.jsx, MentoringProfile.jsx) is disconnected, not deleted, in case
// there's ever a reason to look back at it.
export default function Mentoring() {
  return (
    <Routes>
      <Route index element={<MentorDirectory />} />
      <Route path=":id" element={<MentorProfile />} />
    </Routes>
  )
}
