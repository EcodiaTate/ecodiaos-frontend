import api from './client'

export interface TranscriptSegment {
  speaker: string | null
  start_ms: number
  end_ms: number
  text: string
}

export interface TranscriptData {
  full_text: string
  engine: 'whisper' | 'deepgram'
  diarised: boolean
  segments: TranscriptSegment[]
  paragraphs: TranscriptSegment[]
}

export interface ActionItem {
  id: string
  action: string
  owner: string
  due: string
  priority: 'P1' | 'P2' | 'P3'
  context: string
  timestamp_range: string | null
  dependencies: string[]
  source: 'explicit' | 'implicit'
}

export interface AnalysisDecision {
  decision: string
  rationale: string
  timestamp: string | null
  owner: string | null
}

export interface AnalysisCommitment {
  commitment: string
  owner: string
  to_whom: string
  deadline: string
  timestamp: string | null
}

export interface AnalysisRisk {
  risk: string
  severity: 'high' | 'medium' | 'low'
  context: string
}

export interface AnalysisData {
  one_line_summary: string
  executive_summary: string
  key_decisions: AnalysisDecision[]
  unresolved_questions: Array<{ question: string; context: string; timestamp: string | null }>
  themes: Array<{ theme: string; description: string; timestamp_range: string | null; weight: 'primary' | 'secondary' }>
  standout_moments: Array<{ quote: string; speaker: string; timestamp: string | null; significance: string }>
  sentiment_arc: string
  people_entities: Array<{ name: string; role: string; key_interests: string }>
  commitments: AnalysisCommitment[]
  risks_red_flags: AnalysisRisk[]
  strategic_implications: Array<{ implication: string; timeframe: 'immediate' | 'short-term' | 'long-term' }>
  recommended_next_actions: Array<{ action: string; owner: string; priority: 'P1' | 'P2' | 'P3'; rationale: string }>
}

export interface Meeting {
  id: string
  title: string | null
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  audio_size_bytes: number | null
  audio_source: 'live' | 'upload' | 'uploaded' | null
  transcription_status: 'pending' | 'processing' | 'retrying' | 'done' | 'error' | 'uploaded_awaiting_transcription'
  transcription_error: string | null
  transcript_text: string | null
  transcript_json: TranscriptData | null
  speaker_names: Record<string, string>
  transcript_diarised: boolean
  transcript_engine: 'whisper' | 'deepgram' | null
  analysis_status: 'pending' | 'processing' | 'done' | 'error'
  analysis_json: AnalysisData | null
  action_items_json: ActionItem[] | null
  analysis_completed_at: string | null
  analysis_error: string | null
  client_id: string | null
  client_name: string | null
  attendees: string | null
  created_at: string
  audio_signed_url?: string | null
}

export async function listMeetings(limit = 20, offset = 0) {
  const res = await api.get<{ meetings: Meeting[]; total: number }>('/meetings', {
    params: { limit, offset },
  })
  return res.data
}

export async function getMeeting(id: string) {
  const res = await api.get<Meeting>(`/meetings/${id}`)
  return res.data
}

export async function createMeeting(opts?: { title?: string; client_id?: string; project_id?: string }) {
  const res = await api.post<{ id: string; started_at: string }>('/meetings', opts || {})
  return res.data
}

export async function uploadChunk(meetingId: string, chunkIndex: number, blob: Blob) {
  const form = new FormData()
  form.append('chunk', blob, `${chunkIndex}.webm`)
  form.append('chunkIndex', String(chunkIndex))
  const res = await api.post<{ ok: boolean; chunkIndex: number; stored: boolean }>(
    `/meetings/${meetingId}/chunk`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return res.data
}

/**
 * Upload a local audio file to attach to an EXISTING meeting (rescue path for lost live captures).
 * Fires the transcription pipeline once uploaded.
 */
export async function uploadAudio(
  meetingId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ ok: boolean; transcription_status: string }> {
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await api.post<{ ok: boolean; transcription_status: string }>(
    `/meetings/${meetingId}/upload-audio`,
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress
        ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)) }
        : undefined,
    },
  )
  return res.data
}

export async function stopMeeting(meetingId: string, durationSeconds?: number) {
  const res = await api.post<{ ok: boolean; transcription_status: string; idempotent?: boolean }>(
    `/meetings/${meetingId}/stop`,
    { duration_seconds: durationSeconds },
  )
  return res.data
}

export async function retranscribeMeeting(meetingId: string) {
  const res = await api.post<{ transcript_text: string; transcript_json: TranscriptData; transcript_revised_at: string }>(
    `/meetings/${meetingId}/retranscribe`,
  )
  return res.data
}

export async function updateSpeakers(meetingId: string, speakers: Record<string, string>) {
  const res = await api.patch<{ speaker_names: Record<string, string> }>(
    `/meetings/${meetingId}/speakers`,
    { speakers },
  )
  return res.data
}

export async function reanalyseMeeting(meetingId: string) {
  const res = await api.post<{ queued: boolean; meeting_id: string }>(
    `/meetings/${meetingId}/analyze`,
    { force: true },
  )
  return res.data
}

export async function updateTranscript(meetingId: string, transcriptText: string) {
  const res = await api.patch<{ transcript_text: string }>(
    `/meetings/${meetingId}/transcript`,
    { transcript_text: transcriptText },
  )
  return res.data
}

export async function updateMeeting(meetingId: string, opts: { title?: string; attendees?: string | null }) {
  const res = await api.patch<Meeting>(`/meetings/${meetingId}`, opts)
  return res.data
}

export async function deleteMeeting(meetingId: string) {
  await api.delete(`/meetings/${meetingId}`)
}

export function getExportUrl(meetingId: string, format: 'md' | 'txt' = 'md') {
  const base = (import.meta.env.VITE_API_URL || '/api')
  return `${base}/meetings/${meetingId}/export?format=${format}`
}

/**
 * Upload a pre-recorded audio file as a new meeting.
 * Creates the meeting row, uploads to storage, and fires the transcription
 * pipeline in one HTTP call.
 *
 * @param file        - Audio file (mp3, m4a, wav, webm, ogg, mp4)
 * @param opts.title  - Optional title (defaults to filename without extension)
 * @param opts.onProgress - Upload progress callback (0-100)
 */
export async function uploadMeetingFile(
  file: File,
  opts?: { title?: string; onProgress?: (pct: number) => void },
): Promise<{ id: string; audio_url: string; status: string }> {
  const form = new FormData()
  form.append('file', file)
  if (opts?.title) form.append('title', opts.title)

  const res = await api.post<{ id: string; audio_url: string; status: string }>(
    '/meetings/upload',
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: opts?.onProgress
        ? (e) => {
            if (e.total) opts.onProgress!(Math.round((e.loaded / e.total) * 100))
          }
        : undefined,
    },
  )
  return res.data
}

export interface EmailSend {
  id: string
  sent_to: string[]
  subject: string | null
  resend_message_id: string | null
  status: 'sent' | 'error'
  error_text: string | null
  sent_at: string
}

export async function emailMeetingAnalysis(
  meetingId: string,
  payload: { to: string; subject?: string; note?: string },
): Promise<{ ok: boolean; message_id: string | null; sent_to: string[] }> {
  const res = await api.post<{ ok: boolean; message_id: string | null; sent_to: string[] }>(
    `/meetings/${meetingId}/email`,
    payload,
  )
  return res.data
}

export async function getMeetingEmailSends(meetingId: string): Promise<{ sends: EmailSend[] }> {
  const res = await api.get<{ sends: EmailSend[] }>(`/meetings/${meetingId}/email-sends`)
  return res.data
}
