import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useUserProfile } from '../App'
import { useQueryClient } from '@tanstack/react-query'
import { fmtProjectId } from '../lib/projectId'
import { PlanSetup } from './desk/PlanSetup'

const PROJECT_TYPES = [
  { label: 'Residential', icon: '🏠' },
  { label: 'Commercial',  icon: '🏢' },
  { label: 'Villa',       icon: '🏡' },
  { label: 'Apartment',   icon: '🏗️' },
  { label: 'Industrial',  icon: '🏭' },
  { label: 'Renovation',  icon: '🔨' },
]

const fmtId = fmtProjectId   // shared generator (src/lib/projectId.ts)

// Celebration particle
function Particle({ delay, x, color }: { delay: number; x: number; color: string }) {
  return (
    <span
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: '50%',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: color,
        animation: `celebFly 1.2s ease-out ${delay}ms forwards`,
        pointerEvents: 'none',
      }}
    />
  )
}

const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  x: 10 + Math.random() * 80,
  delay: i * 60,
  color: ['#C8603A', '#0b1c30', '#d4a574', '#6b8f9e', '#b8c5cc'][i % 5],
}))

export default function NewProjectWizard({ session }: { session: Session }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: profile } = useUserProfile(session.user.id)

  const [step, setStep] = useState(0) // 0=name, 1=details, 2=construction, 3=celebrate
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [projectCode, setProjectCode] = useState('')
  const [projType, setProjType] = useState('Residential')
  const [location, setLocation] = useState('')
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createdProjectId, setCreatedProjectId] = useState('')
  const [animDir, setAnimDir] = useState<'in' | 'out'>('in')
  const nameRef = useRef<HTMLInputElement>(null)
  const locRef  = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])
  useEffect(() => {
    if (!name) { setProjectId(''); return }
    setProjectId(fmtId(name))
  }, [name])

  useEffect(() => {
    if (!name) { setProjectCode(''); return }
    const code = name
      .replace(/\b(villa|flat|building|project|new|phase|the|and|of|for|at|in|a|an|dr|mr|mrs)\b/gi, '')
      .replace(/[^a-zA-Z]/g, '')
      .substring(0, 4)
      .toUpperCase()
    setProjectCode(code || name.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase())
  }, [name])

  useEffect(() => {
    if (step === 1) setTimeout(() => locRef.current?.focus(), 320)
  }, [step])

  function goNext() {
    setAnimDir('out')
    setTimeout(() => { setStep(s => s + 1); setAnimDir('in') }, 220)
  }

  async function handleCreate() {
    if (!name.trim() || !location.trim()) return
    if (name.trim().length < 4) { setError('Project name must be at least 4 characters'); return }
    if (projectCode.length < 2) { setError('Site code must be at least 2 characters'); return }
    setSaving(true); setError('')
    try {
      const resolvedOrgId = profile?.org_id
      if (!resolvedOrgId) throw new Error('No org found — please reload.')
      const pid = projectId || fmtId(name)
      const { data, error: err } = await supabase.from('projects').insert({
        project_id: pid,
        org_id: resolvedOrgId,
        name: name.trim(),
        project_code: projectCode,
        project_type: projType,            // persist the captured type (H3)
        site_location: location.trim(),
        status: 'Active',
        created_by: session.user.id,
        start_date: startDate,
      }).select().single()
      if (err) throw err
      setCreatedProjectId(data.project_id)
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['sidebar_projects'] })
      goNext() // → step 2 celebration
    } catch (e: any) {
      setError(e.message || 'Failed to create project')
    } finally {
      setSaving(false)
    }
  }

  // Auto-navigate after celebration — land on the Task Manager with the first-arrival cascade.
  useEffect(() => {
    if (step === 3 && createdProjectId) {
      const t = setTimeout(() => navigate(`/projects/${createdProjectId}/tasks`, { state: { justCreated: true } }), 2200)
      return () => clearTimeout(t)
    }
  }, [step, createdProjectId, navigate])

  const steps = [
    { label: 'Name', pct: 0 },
    { label: 'Details', pct: 33 },
    { label: 'Build', pct: 66 },
    { label: 'Done', pct: 100 },
  ]

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg, #f8f9ff 0%, #f4f0eb 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle background orbs */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(200,96,58,0.04) 0%, transparent 70%)', top: -100, right: -100 }} />
        <div style={{ position: 'absolute', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(11,28,48,0.03) 0%, transparent 70%)', bottom: -80, left: -80 }} />
      </div>

      {/* Back button */}
      {step < 2 && (
        <button
          onClick={() => navigate('/projects')}
          style={{
            position: 'absolute', top: 24, left: 24,
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 13, color: 'rgba(0,0,0,0.4)',
            padding: '6px 10px', borderRadius: 8,
            transition: 'color 150ms, background 150ms',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#0b1c30'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.04)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(0,0,0,0.4)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 11L5 7L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Cancel
        </button>
      )}

      {/* Logo mark */}
      <div style={{ marginBottom: 40 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.7 }}>
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#0b1c30" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="#0b1c30" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="#0b1c30" strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Progress */}
      {step < 3 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 40 }}>
          {steps.map((s, i) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: i < step ? 20 : i === step ? 20 : 20,
                height: 4,
                borderRadius: 99,
                background: i < step ? '#C8603A' : i === step ? '#C8603A' : 'rgba(0,0,0,0.10)',
                opacity: i < step ? 1 : i === step ? 1 : 0.5,
                transition: 'background 300ms, opacity 300ms',
              }} />
              {i < steps.length - 1 && <div style={{ width: 16, height: 1, background: 'rgba(0,0,0,0.08)' }} />}
            </div>
          ))}
        </div>
      )}

      {/* Card — it WIDENS for the building.
          Steps 0/1/3 are a column of fields and read best narrow. Step 2 is the plan-setup card, which
          is a form BESIDE a drawing: at 520px the drawing had nowhere to stand and was being cropped.
          So the card grows to fit the thing inside it, and the growth is animated — the card opening
          up is the page making room, which is exactly what is happening. */}
      <div
        style={{
          width: '100%', maxWidth: step === 2 ? 980 : 520,
          transition: 'max-width 360ms cubic-bezier(.2,.8,.3,1)',
          background: '#ffffff',
          borderRadius: 24,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 20px 60px rgba(0,0,0,0.06)',
          overflow: 'hidden',
          animation: animDir === 'in' ? 'wizardSlideIn 280ms cubic-bezier(0.34,1.56,0.64,1) forwards' : 'wizardSlideOut 220ms ease-in forwards',
        }}
      >
        {/* Step 0: Name */}
        {step === 0 && (
          <div style={{ padding: '48px 48px 40px' }}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#C8603A', opacity: 0.7 }}>
                Step 1 of 2
              </span>
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0b1c30', letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: 8, fontFamily: 'Manrope, sans-serif' }}>
              Name your project
            </h1>
            <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)', marginBottom: 36, lineHeight: 1.5 }}>
              Every great build starts with a name.
            </p>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 8 }}>
                Project Name
              </label>
              <input
                ref={nameRef}
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && name.trim().length >= 4 && goNext()}
                placeholder="e.g. Sunrise Villa Phase 1"
                style={{
                  width: '100%', height: 52, padding: '0 16px',
                  borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.10)',
                  fontSize: 16, color: '#0b1c30', outline: 'none',
                  transition: 'border-color 200ms',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
                onFocus={e => (e.target.style.borderColor = '#C8603A')}
                onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.10)')}
              />
              {projectId && (
                <p style={{ marginTop: 6, fontSize: 11, color: 'rgba(0,0,0,0.35)', fontFamily: 'Geist Mono, monospace' }}>
                  ID: {projectId}
                </p>
              )}
              {name.trim().length > 0 && name.trim().length < 4 && (
                <p style={{ marginTop: 6, fontSize: 12, color: '#e53e3e' }}>
                  Project name must be at least 4 characters
                </p>
              )}
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 8 }}>
                Site Code
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6, opacity: 0.6 }}>· 2–6 chars, used in WO &amp; PO IDs</span>
              </label>
              <input
                value={projectCode}
                onChange={e =>
                  setProjectCode(
                    e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 6)
                  )
                }
                placeholder="e.g. MADU"
                maxLength={6}
                style={{
                  width: '100%', height: 52, padding: '0 16px',
                  borderRadius: 14, border: `1.5px solid ${projectCode.length > 0 && projectCode.length < 2 ? '#e53e3e' : 'rgba(0,0,0,0.10)'}`,
                  fontSize: 16, color: '#0b1c30', outline: 'none',
                  transition: 'border-color 200ms',
                  fontFamily: 'Geist Mono, monospace',
                  letterSpacing: '0.1em',
                  boxSizing: 'border-box',
                }}
                onFocus={e => (e.target.style.borderColor = '#C8603A')}
                onBlur={e => (e.target.style.borderColor = projectCode.length > 0 && projectCode.length < 2 ? '#e53e3e' : 'rgba(0,0,0,0.10)')}
              />
              {projectCode ? (
                <p style={{ marginTop: 6, fontSize: 11, color: 'rgba(0,0,0,0.35)', fontFamily: 'Geist Mono, monospace' }}>
                  WO-{projectCode}-YYMMDD-001 &nbsp;&middot;&nbsp; PO-{projectCode}-YYMMDD-001
                </p>
              ) : (
                <p style={{ marginTop: 6, fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>
                  Auto-suggested from project name · edit freely
                </p>
              )}
            </div>

            <div style={{ marginBottom: 36 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 10 }}>
                Project Type
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {PROJECT_TYPES.map(t => (
                  <button
                    key={t.label}
                    onClick={() => setProjType(t.label)}
                    style={{
                      padding: '10px 8px',
                      borderRadius: 12,
                      border: `1.5px solid ${projType === t.label ? '#C8603A' : 'rgba(0,0,0,0.08)'}`,
                      background: projType === t.label ? 'rgba(200,96,58,0.05)' : 'transparent',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: projType === t.label ? '#C8603A' : 'rgba(0,0,0,0.55)',
                      fontWeight: projType === t.label ? 600 : 400,
                      transition: 'all 150ms',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => name.trim().length >= 4 && projectCode.length >= 2 && goNext()}
              disabled={name.trim().length < 4 || projectCode.length < 2}
              style={{
                width: '100%', height: 52, borderRadius: 14,
                background: name.trim().length >= 4 && projectCode.length >= 2 ? '#0b1c30' : 'rgba(0,0,0,0.06)',
                color: name.trim().length >= 4 && projectCode.length >= 2 ? '#ffffff' : 'rgba(0,0,0,0.25)',
                border: 'none', cursor: name.trim().length >= 4 && projectCode.length >= 2 ? 'pointer' : 'not-allowed',
                fontSize: 15, fontWeight: 600,
                transition: 'all 200ms',
                letterSpacing: '-0.01em',
              }}
            >
              Continue →
            </button>
          </div>
        )}

        {/* Step 1: Details */}
        {step === 1 && (
          <div style={{ padding: '48px 48px 40px' }}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#C8603A', opacity: 0.7 }}>
                Step 2 of 3
              </span>
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0b1c30', letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: 8, fontFamily: 'Manrope, sans-serif' }}>
              Where & when?
            </h1>
            <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)', marginBottom: 36, lineHeight: 1.5 }}>
              Site details help you track everything in one place.
            </p>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 8 }}>
                Site Location
              </label>
              <input
                ref={locRef}
                value={location}
                onChange={e => setLocation(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && location.trim() && handleCreate()}
                placeholder="e.g. Jubilee Hills, Hyderabad"
                style={{
                  width: '100%', height: 52, padding: '0 16px',
                  borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.10)',
                  fontSize: 15, color: '#0b1c30', outline: 'none',
                  transition: 'border-color 200ms',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
                onFocus={e => (e.target.style.borderColor = '#C8603A')}
                onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.10)')}
              />
            </div>

            <div style={{ marginBottom: 36 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 8 }}>
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                style={{
                  width: '100%', height: 52, padding: '0 16px',
                  borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.10)',
                  fontSize: 15, color: '#0b1c30', outline: 'none',
                  transition: 'border-color 200ms',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
                onFocus={e => (e.target.style.borderColor = '#C8603A')}
                onBlur={e => (e.target.style.borderColor = 'rgba(0,0,0,0.10)')}
              />
            </div>

            {error && (
              <p style={{ color: '#e53e3e', fontSize: 13, marginBottom: 16, padding: '10px 14px', background: 'rgba(229,62,62,0.06)', borderRadius: 10 }}>
                {error}
              </p>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setAnimDir('out'); setTimeout(() => { setStep(0); setAnimDir('in') }, 220) }}
                style={{
                  flex: '0 0 auto', height: 52, padding: '0 20px', borderRadius: 14,
                  background: 'transparent', color: 'rgba(0,0,0,0.45)',
                  border: '1.5px solid rgba(0,0,0,0.10)', cursor: 'pointer',
                  fontSize: 14, fontWeight: 500, transition: 'all 150ms',
                }}
              >
                ← Back
              </button>
              <button
                onClick={handleCreate}
                disabled={!location.trim() || saving}
                style={{
                  flex: 1, height: 52, borderRadius: 14,
                  background: location.trim() && !saving ? '#C8603A' : 'rgba(0,0,0,0.06)',
                  color: location.trim() && !saving ? '#ffffff' : 'rgba(0,0,0,0.25)',
                  border: 'none', cursor: location.trim() && !saving ? 'pointer' : 'not-allowed',
                  fontSize: 15, fontWeight: 600,
                  transition: 'all 200ms',
                  letterSpacing: '-0.01em',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {saving ? (
                  <>
                    <svg style={{ animation: 'spin 1s linear infinite', width: 16, height: 16 }} viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                    </svg>
                    Creating…
                  </>
                ) : 'Create Project'}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Construction set-up — the meta that generates the task plan (skippable) */}
        {step === 2 && createdProjectId && (
          <div style={{ padding: 'clamp(24px, 4vw, 44px) clamp(16px, 3.5vw, 44px) 40px' }}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#C8603A', opacity: 0.7 }}>
                Step 3 of 3
              </span>
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0b1c30', letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: 8, fontFamily: 'Manrope, sans-serif' }}>
              Build the task plan
            </h1>
            <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)', marginBottom: 28, lineHeight: 1.5 }}>
              A few details about the build generate the full site task list automatically. You can skip and set this up later.
            </p>
            {/* The SAME card the Site Desk shows on an empty plan — same questions, same drawing, same
                generator (setupPlan). A project must not be described one way here and another there. */}
            <PlanSetup
              projectId={createdProjectId}
              projectType={projType}
              onComplete={goNext}
              onSkip={goNext}
            />
          </div>
        )}

        {/* Step 3: Celebration */}
        {step === 3 && (
          <div style={{ padding: '56px 48px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
            {/* Particles */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {PARTICLES.map((p, i) => (
                <Particle key={i} x={p.x} delay={p.delay} color={p.color} />
              ))}
            </div>

            {/* Checkmark */}
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'linear-gradient(135deg, #C8603A 0%, #a0432a 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 28px',
              boxShadow: '0 8px 32px rgba(200,96,58,0.3)',
              animation: 'celebPop 400ms cubic-bezier(0.34,1.56,0.64,1) forwards',
            }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M8 16L13 21L24 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ strokeDasharray: 24, strokeDashoffset: 24, animation: 'drawCheck 400ms ease 200ms forwards' }}
                />
              </svg>
            </div>

            <h2 style={{ fontSize: 26, fontWeight: 700, color: '#0b1c30', letterSpacing: '-0.02em', marginBottom: 8, fontFamily: 'Manrope, sans-serif' }}>
              Project created!
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)', marginBottom: 32 }}>
              Taking you to the <strong style={{ color: '#0b1c30' }}>{name}</strong> task plan…
            </p>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: 120, height: 3, background: 'rgba(0,0,0,0.06)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#C8603A', borderRadius: 99, animation: 'fillBar 2s linear forwards' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes wizardSlideIn {
          from { opacity: 0; transform: translateY(16px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes wizardSlideOut {
          from { opacity: 1; transform: translateY(0); }
          to   { opacity: 0; transform: translateY(-12px); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes celebPop {
          from { transform: scale(0.5); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes drawCheck {
          to { stroke-dashoffset: 0; }
        }
        @keyframes celebFly {
          0%   { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-120px) scale(0.3); opacity: 0; }
        }
        @keyframes fillBar {
          from { width: 0%; }
          to   { width: 100%; }
        }
      `}</style>
    </div>
  )
}
