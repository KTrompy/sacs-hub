import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import { PdfIcon } from './Jobs.jsx'
import { useToast } from './Toast.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

// Downloads a file from the private job-application-files bucket by creating
// a short-lived signed URL (60 s) and opening it in a new tab.
async function downloadFile(path, fallbackName) {
  const { data, error } = await supabase.storage
    .from('job-application-files')
    .createSignedUrl(path, 60)
  if (error || !data?.signedUrl) {
    console.error('Signed URL error', error)
    return
  }
  const a = document.createElement('a')
  a.href = data.signedUrl
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.download = fallbackName || 'download'
  a.click()
}

// Shown on the job detail page when the current user is the poster.
// Lists every application with cover letter, CV download, and optional
// cover-letter-document download.
export default function JobApplications({ jobId, session }) {
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const showToast = useToast()

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('job_applications')
      .select('*, profiles:applicant_id ( id, full_name, avatar_url, grad_year, occupation, company )')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
    if (error) console.error(error)
    setApps(data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel(`job-apps-${jobId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'job_applications',
        filter: `job_id=eq.${jobId}`,
      }, () => load())
      // This filter only works because schema-update-47 set job_applications
      // to REPLICA IDENTITY FULL. Under the default replica identity a DELETE
      // payload carries primary-key columns only — and this table's PK is
      // `id`, so `job_id` was never in the payload and the filter could never
      // match. The listener silently never fired, and a withdrawn application
      // stayed on the poster's screen until they reloaded the page.
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'job_applications',
        filter: `job_id=eq.${jobId}`,
      }, () => load())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [jobId])

  if (loading) return <LoadingState message="Loading applications…" />

  if (apps.length === 0) {
    return (
      <EmptyState
        icon="people"
        message="No applications yet."
        subMessage="Applications from fellow Old Boys will appear here."
      />
    )
  }

  return (
    <div className="job-applications-list">
      <p className="result-count">{apps.length} {apps.length === 1 ? 'application' : 'applications'}</p>
      {apps.map((app) => {
        const p = app.profiles
        return (
          <div key={app.id} className="job-application-card">
            <div className="job-application-header">
              <button type="button" className="job-poster" onClick={() => p?.id && navigate(`/people/${p.id}`)}>
                <Avatar url={p?.avatar_url} name={p?.full_name} size={36} />
                <span className="job-application-person">
                  <strong>{p?.full_name || 'Applicant'}</strong>
                  <span className="job-application-meta">
                    {[p?.occupation, p?.company, p?.grad_year && `Class of ${p.grad_year}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
              <span className="job-application-time">{timeAgo(app.created_at)}</span>
            </div>

            {app.cover_letter && (
              <div className="job-application-cover">
                <p>{app.cover_letter}</p>
              </div>
            )}

            <div className="job-application-files">
              {app.cv_url && (
                <button type="button" className="btn ghost small" onClick={() => downloadFile(app.cv_url, app.cv_name)}>
                  <PdfIcon /> {app.cv_name || 'CV'}
                </button>
              )}
              {app.cover_letter_url && (
                <button type="button" className="btn ghost small" onClick={() => downloadFile(app.cover_letter_url, app.cover_letter_name)}>
                  <PdfIcon /> {app.cover_letter_name || 'Cover letter'}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
