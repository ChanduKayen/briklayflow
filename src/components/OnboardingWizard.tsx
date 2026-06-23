import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import {
  IconCheck,
  IconLoader2,
  IconLayoutGrid,
  IconLayoutSidebar,
  IconFileInvoice,
  IconHammer,
  IconCircleCheck,
  IconUser,
  IconUsers,
  IconBuilding,
  IconBuildingSkyscraper,
} from '@tabler/icons-react'
import { supabase } from '../lib/supabase'
import type { UserProfile } from '../types'

const STEPS = ['welcome', 'team', 'project', 'orders', 'shortcuts', 'finish'] as const
const PROGS = ['16%', '33%', '50%', '66%', '83%', '100%']

const SC_KEYS = ['t', 'p', 'w', 'l', '/'] as const
const SC_ITEMS = [
  { key: 'T', action: 'New transaction',    hint: 'Most common action on site' },
  { key: 'P', action: 'New purchase order', hint: 'Raise a PO in seconds' },
  { key: 'W', action: 'New contract',     hint: 'Assign work to contractors' },
  { key: 'L', action: 'Open logbook',       hint: 'All site entries in one view' },
  { key: '/', action: 'New entry',          hint: 'Pick what to create' },
]

const TEAM_SIZES = [
  { label: 'Just me', sub: 'Solo principal',    Icon: IconUser },
  { label: '2 – 5',   sub: 'Small crew',        Icon: IconUsers },
  { label: '6 – 20',  sub: 'Mid-size team',     Icon: IconBuilding },
  { label: '20+',     sub: 'Large organisation', Icon: IconBuildingSkyscraper },
]

const PROJ_TYPES = ['Residential', 'Commercial', 'Villa', 'Apartment', 'Industrial', 'Renovation']

const CONFETTI_COLORS = ['#1a1a1a', '#888', '#bbb', '#c4b5a5', '#6b6b6b']

type Props = {
  session: Session
  profile: UserProfile
  orgName?: string
  orgId?:   string
  onComplete: () => void
}

export default function OnboardingWizard({ profile, orgName, orgId, onComplete }: Props) {
  const navigate = useNavigate()
  const [step, setStep]               = useState(0)
  const [teamSize, setTeamSize]       = useState('Just me')
  const [projName, setProjName]       = useState('')
  const [projType, setProjType]       = useState('Residential')
  const [projCreated, setProjCreated] = useState(false)
  const [projSaved, setProjSaved]     = useState('')
  const [projTypeStr, setProjTypeStr] = useState('Residential')
  const [scIdx, setScIdx]             = useState(0)
  const [scDone, setScDone]           = useState<number[]>([])
  const [finishing, setFinishing]     = useState(false)
  const [creating, setCreating]       = useState(false)

  useEffect(() => {
    if (step !== 4) return
    function handleKey(e: KeyboardEvent) {
      // Don't fire on input elements
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const pressed = e.key === '/' ? '/' : e.key.toLowerCase()
      if (scIdx >= SC_KEYS.length) return
      if (pressed !== SC_KEYS[scIdx]) return
      setScDone(prev => [...prev, scIdx])
      setScIdx(prev => prev + 1)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [step, scIdx])

  async function handleCreateProject() {
    setCreating(true)
    const name          = projName.trim() || 'My First Project'
    const resolvedOrgId = orgId ?? profile.org_id
    const { error } = await supabase
      .from('projects')
      .insert({
        project_id:    crypto.randomUUID(),
        org_id:        resolvedOrgId,
        name,
        status:        'Active',
        created_by:    profile.id,
        start_date:    new Date().toISOString().split('T')[0],
      })
    if (error) console.error('[OnboardingWizard] project creation failed:', error)
    setCreating(false)
    setProjSaved(name)
    setProjTypeStr(projType)
    setProjCreated(true)
  }

  async function handleFinish(dest: '/ledger/new' | '/dashboard') {
    if (finishing) return
    setFinishing(true)
    await supabase
      .from('user_profiles')
      .update({ onboarding_done: true })
      .eq('id', profile.id)
    onComplete()
    navigate(dest, { replace: true })
  }

  const displayOrg = orgName || (profile.name ? `${profile.name}'s workspace` : 'Your workspace')

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#f8f9ff',
      zIndex: 9999,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '0 16px',
    }}>
      <style>{`
        @keyframes bk-wizard-fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes bk-wizard-spring {
          0%   { transform: scale(0); }
          60%  { transform: scale(1.12); }
          80%  { transform: scale(0.95); }
          100% { transform: scale(1); }
        }
        @keyframes bk-wizard-pulse {
          0%   { box-shadow: 0 0 0 0px rgba(0,0,0,0.15); }
          50%  { box-shadow: 0 0 0 5px rgba(0,0,0,0.06); }
          100% { box-shadow: 0 0 0 0px rgba(0,0,0,0.15); }
        }
        @keyframes bk-confetti-fall {
          0%   { transform: translateY(-4px) rotate(0deg);   opacity: 1; }
          100% { transform: translateY(72px)  rotate(380deg); opacity: 0; }
        }
        .bk-wizard-step { animation: bk-wizard-fadeUp 0.35s ease both; }
      `}</style>

      {/* Card */}
      <div style={{
        width: 560,
        maxWidth: '100%',
        minHeight: 520,
        background: '#ffffff',
        border: '0.5px solid rgba(0,0,0,0.10)',
        borderRadius: 20,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
      }}>

        {/* Progress bar */}
        <div style={{ height: 2, background: 'rgba(0,0,0,0.08)', flexShrink: 0 }}>
          <div style={{
            height: '100%',
            width: PROGS[step],
            background: '#000000',
            transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
          }} />
        </div>

        {/* Step content */}
        <div
          key={step}
          className="bk-wizard-step"
          style={{
            flex: 1,
            padding: 'clamp(28px, 6vw, 44px)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          {step === 0 && (
            <WelcomeStep profile={profile} onNext={() => setStep(1)} />
          )}
          {step === 1 && (
            <TeamStep teamSize={teamSize} onSelect={setTeamSize} onNext={() => setStep(2)} />
          )}
          {step === 2 && (
            <ProjectStep
              projName={projName}
              setProjName={setProjName}
              projType={projType}
              setProjType={setProjType}
              projCreated={projCreated}
              projSaved={projSaved}
              projTypeStr={projTypeStr}
              creating={creating}
              onCreate={handleCreateProject}
              onSkip={() => setStep(3)}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && <OrdersStep onNext={() => setStep(4)} />}
          {step === 4 && (
            <ShortcutsStep
              scIdx={scIdx}
              scDone={scDone}
              allDone={scIdx >= SC_KEYS.length}
              onNext={() => setStep(5)}
            />
          )}
          {step === 5 && (
            <FinishStep
              orgName={displayOrg}
              finishing={finishing}
              onRecord={() => handleFinish('/ledger/new')}
              onDashboard={() => handleFinish('/dashboard')}
            />
          )}
        </div>

        {/* Nav dots */}
        <div style={{
          display: 'flex', gap: 5, justifyContent: 'center',
          padding: '14px 0 16px', flexShrink: 0,
        }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              height: 4,
              width: i === step ? 14 : 4,
              borderRadius: 2,
              background: i === step ? '#000000' : 'rgba(0,0,0,0.14)',
              transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)',
            }} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Step 0: Welcome ───────────────────────────────────────────────────────────

function WelcomeStep({ profile, onNext }: { profile: UserProfile; onNext: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <p style={{ fontSize: 10, letterSpacing: '0.1em', color: 'rgba(0,0,0,0.38)', margin: 0, textTransform: 'uppercase' }}>
        ◈ Briklay
      </p>
      <h1 style={{ fontSize: 28, fontWeight: 500, color: '#0b1c30', margin: 0, lineHeight: 1.25 }}>
        Welcome,<br />{profile.name || 'there'}.
      </h1>
      <p style={{ fontSize: 14, color: '#45464d', margin: 0, lineHeight: 1.65 }}>
        Your construction workspace is ready.<br />
        Two minutes to set it up right.
      </p>
      <button className="bk-btn" style={{ marginTop: 8 }} onClick={onNext}>
        Get started →
      </button>
    </div>
  )
}

// ── Step 1: Team ──────────────────────────────────────────────────────────────

function TeamStep({
  teamSize, onSelect, onNext,
}: {
  teamSize: string; onSelect: (s: string) => void; onNext: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, width: '100%' }}>
      <div>
        <p style={{ fontSize: 11, letterSpacing: '0.07em', color: 'rgba(0,0,0,0.38)', margin: '0 0 6px', textTransform: 'uppercase' }}>
          Your team
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#0b1c30', margin: 0 }}>
          How big is your team?
        </h1>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 10, maxWidth: 340, width: '100%',
      }}>
        {TEAM_SIZES.map(ts => {
          const selected = teamSize === ts.label
          const TsIcon = ts.Icon
          return (
            <button
              key={ts.label}
              onClick={() => onSelect(ts.label)}
              style={{
                background: selected ? '#ffffff' : '#eff4ff',
                border: selected ? '1.5px solid #000000' : '0.5px solid rgba(0,0,0,0.10)',
                borderRadius: 12,
                padding: '18px 14px',
                cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                transition: 'all 0.18s ease',
              }}
            >
              <TsIcon size={20} strokeWidth={1.5} color={selected ? '#000000' : '#45464d'} />
              <span style={{ fontSize: 13, fontWeight: 500, color: selected ? '#000000' : '#0b1c30' }}>
                {ts.label}
              </span>
              <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>{ts.sub}</span>
            </button>
          )
        })}
      </div>

      <button className="bk-btn" onClick={onNext}>
        Continue →
      </button>
    </div>
  )
}

// ── Step 2: Project ───────────────────────────────────────────────────────────

function ProjectStep({
  projName, setProjName, projType, setProjType,
  projCreated, projSaved, projTypeStr, creating,
  onCreate, onSkip, onNext,
}: {
  projName: string; setProjName: (s: string) => void
  projType: string; setProjType: (s: string) => void
  projCreated: boolean; projSaved: string; projTypeStr: string; creating: boolean
  onCreate: () => void; onSkip: () => void; onNext: () => void
}) {
  if (projCreated) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        {/* Tick ring */}
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          border: '1.5px solid #006c49',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'bk-wizard-spring 0.5s cubic-bezier(0.34,1.56,0.64,1) both',
        }}>
          <IconCheck size={22} color="#006c49" />
        </div>

        <p style={{ fontSize: 11, letterSpacing: '0.07em', color: 'rgba(0,0,0,0.38)', margin: 0, textTransform: 'uppercase' }}>
          Project created
        </p>

        {/* Project pill */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: '#eff4ff', border: '0.5px solid rgba(0,0,0,0.10)',
          borderRadius: 10, padding: '10px 16px',
          animation: 'bk-wizard-fadeUp 0.35s ease 0.2s both',
        }}>
          <IconLayoutGrid size={15} color="#45464d" />
          <div style={{ textAlign: 'left' }}>
            <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: '#0b1c30' }}>{projSaved}</p>
            <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', margin: 0 }}>{projTypeStr}</p>
          </div>
        </div>

        {/* Sidebar hint */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: '#eff4ff', border: '0.5px solid rgba(0,0,0,0.10)',
          borderRadius: 10, padding: '12px 16px', maxWidth: 300,
          animation: 'bk-wizard-fadeUp 0.35s ease 0.35s both',
        }}>
          <IconLayoutSidebar size={18} color="rgba(0,0,0,0.38)" />
          <p style={{ fontSize: 12, color: '#45464d', margin: 0, lineHeight: 1.5, textAlign: 'left' }}>
            Find it under{' '}
            <span style={{ fontWeight: 500, color: '#000000' }}>Projects</span>
            {' '}in the left sidebar — anytime.
          </p>
        </div>

        <button className="bk-btn" style={{ marginTop: 4 }} onClick={onNext}>
          Continue →
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, width: '100%' }}>
      <div>
        <p style={{ fontSize: 11, letterSpacing: '0.07em', color: 'rgba(0,0,0,0.38)', margin: '0 0 6px', textTransform: 'uppercase' }}>
          First project
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#0b1c30', margin: '0 0 6px' }}>
          What are you building?
        </h1>
        <p style={{ fontSize: 13, color: '#45464d', margin: 0 }}>
          Every transaction, order and person lives under a project.
        </p>
      </div>

      {/* Name input */}
      <div style={{ width: '100%', maxWidth: 380, textAlign: 'left' }}>
        <label style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', display: 'block', marginBottom: 6 }}>
          Project name
        </label>
        <input
          value={projName}
          onChange={e => setProjName(e.target.value)}
          placeholder="e.g. Krishna Villa"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#eff4ff', border: '0.5px solid rgba(0,0,0,0.12)',
            borderRadius: 8, padding: '11px 14px', fontSize: 14,
            color: '#0b1c30', outline: 'none',
            transition: 'border 0.15s, background 0.15s',
          }}
          onFocus={e => {
            e.target.style.border = '1.5px solid #000000'
            e.target.style.background = '#ffffff'
          }}
          onBlur={e => {
            e.target.style.border = '0.5px solid rgba(0,0,0,0.12)'
            e.target.style.background = '#eff4ff'
          }}
        />
      </div>

      {/* Type chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 380 }}>
        {PROJ_TYPES.map(t => (
          <button
            key={t}
            onClick={() => setProjType(t)}
            style={{
              fontSize: 12, padding: '5px 14px', borderRadius: 9999,
              border: '0.5px solid rgba(0,0,0,0.14)',
              background: projType === t ? '#000000' : 'transparent',
              color: projType === t ? '#ffffff' : '#45464d',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <button
        className="bk-btn"
        onClick={onCreate}
        disabled={creating}
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      >
        {creating
          ? <><IconLoader2 size={15} className="animate-spin" strokeWidth={2} />Creating…</>
          : 'Create project →'
        }
      </button>

      <button
        onClick={onSkip}
        style={{ background: 'none', border: 'none', fontSize: 12, color: 'rgba(0,0,0,0.38)', cursor: 'pointer' }}
      >
        Skip for now
      </button>
    </div>
  )
}

// ── Step 3: Orders ────────────────────────────────────────────────────────────

function OrdersStep({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, width: '100%' }}>
      <div>
        <p style={{ fontSize: 11, letterSpacing: '0.07em', color: 'rgba(0,0,0,0.38)', margin: '0 0 6px', textTransform: 'uppercase' }}>
          How it works
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#0b1c30', margin: 0 }}>
          Two documents. Total control.
        </h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 460, width: '100%' }}>
        {/* PO Card */}
        <div style={{
          background: '#eff4ff', border: '0.5px solid rgba(0,0,0,0.10)',
          borderRadius: 12, padding: 18, textAlign: 'left',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
            <IconFileInvoice size={13} color="#45464d" />
            <span style={{ fontSize: 11, color: '#45464d' }}>Purchase order</span>
          </div>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#0b1c30', margin: '0 0 4px' }}>What you buy</p>
          <p style={{ fontSize: 11, color: '#45464d', margin: '0 0 10px', lineHeight: 1.5 }}>
            Track materials from vendors before they arrive on site.
          </p>
          <div style={{ borderTop: '0.5px solid rgba(0,0,0,0.08)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[['Cement · 200 bags', '₹45,000'], ['Steel TMT', '₹1,20,000'], ['Plumbing', '₹18,500']].map(([l, r]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#45464d' }}>
                <span>{l}</span><span>{r}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
            <IconCircleCheck size={12} color="#006c49" />
            <span style={{ fontSize: 11, color: '#006c49' }}>Approved</span>
          </div>
        </div>

        {/* WO Card */}
        <div style={{
          background: '#eff4ff', border: '0.5px solid rgba(0,0,0,0.10)',
          borderRadius: 12, padding: 18, textAlign: 'left',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
            <IconHammer size={13} color="#45464d" />
            <span style={{ fontSize: 11, color: '#45464d' }}>Contract</span>
          </div>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#0b1c30', margin: '0 0 4px' }}>What gets done</p>
          <p style={{ fontSize: 11, color: '#45464d', margin: '0 0 10px', lineHeight: 1.5 }}>
            Assign work with milestones and payment stages.
          </p>
          <div style={{ borderTop: '0.5px solid rgba(0,0,0,0.08)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[['Foundation', 'Done ✓'], ['Superstructure', '60%'], ['Finishing', 'Pending']].map(([l, r]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#45464d' }}>
                <span>{l}</span>
                <span style={{ color: r === 'Done ✓' ? '#006c49' : r === 'Pending' ? 'rgba(0,0,0,0.38)' : '#45464d' }}>
                  {r}
                </span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
            <IconLoader2 size={12} color="#1565C0" />
            <span style={{ fontSize: 11, color: '#1565C0' }}>In progress</span>
          </div>
        </div>
      </div>

      <button className="bk-btn" onClick={onNext}>
        Got it →
      </button>
    </div>
  )
}

// ── Step 4: Shortcuts ─────────────────────────────────────────────────────────

function ShortcutsStep({
  scIdx, scDone, allDone, onNext,
}: {
  scIdx: number; scDone: number[]; allDone: boolean; onNext: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, width: '100%' }}>
      <div>
        <p style={{ fontSize: 11, letterSpacing: '0.07em', color: 'rgba(0,0,0,0.38)', margin: '0 0 6px', textTransform: 'uppercase' }}>
          Keyboard shortcuts
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#0b1c30', margin: '0 0 4px' }}>
          Work at the speed of thought.
        </h1>
        <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.38)', margin: 0 }}>
          Press each key as it lights up.
        </p>
      </div>

      <div style={{
        maxWidth: 400, width: '100%',
        background: '#eff4ff', border: '0.5px solid rgba(0,0,0,0.10)',
        borderRadius: 12, padding: 22,
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {SC_ITEMS.map((sc, i) => {
          const isDone    = scDone.includes(i)
          const isWaiting = i === scIdx && !isDone

          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              opacity: isDone || isWaiting ? 1 : 0.35,
              transition: 'opacity 0.2s',
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 8, flexShrink: 0,
                border: isDone ? 'none' : isWaiting ? '1.5px solid #000000' : '0.5px solid rgba(0,0,0,0.14)',
                background: isDone ? '#000000' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: isWaiting ? 'bk-wizard-pulse 1.2s ease-in-out infinite' : 'none',
                transition: 'all 0.2s',
              }}>
                {isDone
                  ? <IconCheck size={16} color="#ffffff" />
                  : <span style={{ fontSize: 14, fontWeight: 600, color: '#000000' }}>{sc.key}</span>
                }
              </div>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: '#0b1c30', margin: 0 }}>{sc.action}</p>
                <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', margin: 0 }}>{sc.hint}</p>
              </div>
            </div>
          )
        })}

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 5, justifyContent: 'center', marginTop: 4 }}>
          {SC_ITEMS.map((_, i) => (
            <div key={i} style={{
              width: 5, height: 5, borderRadius: '50%',
              background: scDone.includes(i) ? '#000000' : 'rgba(0,0,0,0.14)',
              transition: 'background 0.3s',
            }} />
          ))}
        </div>
      </div>

      {allDone ? (
        <button className="bk-btn" onClick={onNext}>
          Continue →
        </button>
      ) : (
        <button
          onClick={onNext}
          style={{ background: 'none', border: 'none', fontSize: 12, color: 'rgba(0,0,0,0.38)', cursor: 'pointer' }}
        >
          Skip shortcuts
        </button>
      )}
    </div>
  )
}

// ── Step 5: Finish ────────────────────────────────────────────────────────────

function Confetti() {
  const particles = Array.from({ length: 26 }, (_, i) => ({
    id: i,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    left: `${Math.round((i / 26) * 100)}%`,
    delay: `${(i * 0.06).toFixed(2)}s`,
    duration: `${(0.9 + (i % 7) * 0.1).toFixed(1)}s`,
  }))

  return (
    <div style={{ position: 'relative', height: 60, width: '100%', overflow: 'hidden', flexShrink: 0 }}>
      {particles.map(p => (
        <div key={p.id} style={{
          position: 'absolute',
          left: p.left, top: 0,
          width: 5, height: 8,
          background: p.color,
          borderRadius: 1,
          animation: `bk-confetti-fall ${p.duration} ${p.delay} ease-in both`,
        }} />
      ))}
    </div>
  )
}

function FinishStep({
  orgName, finishing, onRecord, onDashboard,
}: {
  orgName: string; finishing: boolean; onRecord: () => void; onDashboard: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, width: '100%' }}>
      <Confetti />

      <div style={{
        width: 54, height: 54, borderRadius: '50%',
        border: '1.5px solid rgba(0,0,0,0.20)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'bk-wizard-spring 0.5s cubic-bezier(0.34,1.56,0.64,1) both',
      }}>
        <IconCheck size={24} color="#000000" />
      </div>

      <div>
        <h1 style={{ fontSize: 26, fontWeight: 500, color: '#0b1c30', margin: '0 0 8px' }}>
          You're all set.
        </h1>
        <p style={{ fontSize: 13, color: '#45464d', margin: 0, lineHeight: 1.65 }}>
          {orgName} is live on Briklay.<br />
          Record your first transaction to get started.
        </p>
      </div>

      <button
        className="bk-btn"
        onClick={onRecord}
        disabled={finishing}
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      >
        {finishing
          ? <IconLoader2 size={15} className="animate-spin" strokeWidth={2} />
          : null
        }
        Record first transaction →
      </button>

      <button
        onClick={onDashboard}
        disabled={finishing}
        style={{
          background: 'none', border: 'none',
          fontSize: 12, color: 'rgba(0,0,0,0.38)',
          cursor: finishing ? 'default' : 'pointer',
        }}
      >
        Go to dashboard
      </button>
    </div>
  )
}
