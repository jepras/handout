import { useEffect, useState } from 'react'
import './App.css'

const API_URL = 'http://localhost:8088'

type Member = {
  id: string
  age: number
  profession_group: string
  region: string
  annual_salary: number
}

type MemberDetail = {
  member_id: string
  age: number
  profession_group: string
  region: string
  annual_salary: number
  membership_status: string
  pension_scheme: string
  employer_id: string
  joined_date: string
  retirement_target_age: number
}

type Case = {
  case_id: string
  member_id: string
  case_type: string
  status: string
  priority: string
  created_at: string
  closed_at: string | null
  sla_hours: number
  breached_sla: number
  outcome: string | null
  complexity_score: number
}

const fmtDKK = (n: number) =>
  new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 }).format(n)

function MembersList({ onSelect }: { onSelect: (id: string) => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_URL}/api/members`)
      .then((r) => r.json())
      .then(setMembers)
      .catch((e) => setError(String(e)))
  }, [])

  if (error) return <p style={{ color: 'crimson' }}>Fejl: {error}</p>

  return (
    <>
      <h1>Min medlemsportefølje</h1>
      <p>{members.length} medlemmer</p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #92004D', textAlign: 'left' }}>
            <th style={{ padding: '0.5rem' }}>ID</th>
            <th style={{ padding: '0.5rem' }}>Alder</th>
            <th style={{ padding: '0.5rem' }}>Faggruppe</th>
            <th style={{ padding: '0.5rem' }}>Region</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Årsløn</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr
              key={m.id}
              onClick={() => onSelect(m.id)}
              style={{ cursor: 'pointer', borderBottom: '1px solid #eee' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#fbe6f0')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <td style={{ padding: '0.5rem', color: '#92004D' }}>{m.id}</td>
              <td style={{ padding: '0.5rem' }}>{m.age}</td>
              <td style={{ padding: '0.5rem' }}>{m.profession_group}</td>
              <td style={{ padding: '0.5rem' }}>{m.region}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{fmtDKK(m.annual_salary)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

type Projection = {
  member_id: string
  retirement_age: number
  expected_monthly_pension: number
  expected_lump_sum: number
  scenario: string
}

type Benchmark = {
  age: number
  age_bracket: string
  national_avg_pension_wealth: number
  source: string
  year: string
  note: string
}

function MemberDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [member, setMember] = useState<MemberDetail | null>(null)
  const [projection, setProjection] = useState<Projection | null>(null)
  const [cases, setCases] = useState<Case[]>([])
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null)
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMember(null)
    setProjection(null)
    setCases([])
    setBenchmark(null)
    setBenchmarkError(null)
    fetch(`${API_URL}/api/members/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => {
        setMember(d.member)
        setProjection(d.projection)
        fetch(`${API_URL}/api/benchmark/pension?age=${d.member.age}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
          .then(setBenchmark)
          .catch((e) => setBenchmarkError(String(e)))
      })
      .catch((e) => setError(String(e)))

    fetch(`${API_URL}/api/cases?member_id=${id}`)
      .then((r) => r.json())
      .then(setCases)
      .catch((e) => setError(String(e)))
  }, [id])

  if (error) return <p style={{ color: 'crimson' }}>Fejl: {error}</p>
  if (!member) return <p>Indlæser…</p>

  return (
    <>
      <button onClick={onBack} style={{ marginBottom: '1rem' }}>← Tilbage</button>
      <h1 style={{ color: '#92004D' }}>{member.member_id}</h1>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 2rem', marginBottom: '2rem' }}>
        <div><strong>Alder:</strong> {member.age}</div>
        <div><strong>Status:</strong> {member.membership_status}</div>
        <div><strong>Faggruppe:</strong> {member.profession_group}</div>
        <div><strong>Ordning:</strong> {member.pension_scheme}</div>
        <div><strong>Region:</strong> {member.region}</div>
        <div><strong>Arbejdsgiver:</strong> {member.employer_id}</div>
        <div><strong>Årsløn:</strong> {fmtDKK(member.annual_salary)}</div>
        <div><strong>Indmeldt:</strong> {member.joined_date}</div>
        <div><strong>Pensionsalder:</strong> {member.retirement_target_age}</div>
      </section>

      <section style={{ marginBottom: '2rem', padding: '1rem', background: '#fbe6f0', borderLeft: '4px solid #92004D' }}>
        <h2 style={{ marginTop: 0 }}>Pensionsopsparing vs. landsgennemsnit</h2>
        {!projection && <p style={{ color: '#666' }}>Ingen pensionsprognose for dette medlem.</p>}
        {projection && benchmarkError && <p style={{ color: 'crimson' }}>Kunne ikke hente benchmark: {benchmarkError}</p>}
        {projection && !benchmark && !benchmarkError && <p>Henter benchmark…</p>}
        {projection && benchmark && (() => {
          const diff = projection.expected_lump_sum - benchmark.national_avg_pension_wealth
          const pct = (diff / benchmark.national_avg_pension_wealth) * 100
          const above = diff >= 0
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '0.5rem' }}>
                <div>
                  <div style={{ fontSize: '0.85rem', color: '#666' }}>Forventet opsparing v. pension</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>{fmtDKK(projection.expected_lump_sum)}</div>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>{fmtDKK(projection.expected_monthly_pension)}/md fra alder {projection.retirement_age}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.85rem', color: '#666' }}>Landsgennemsnit (alder {benchmark.age_bracket})</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>{fmtDKK(benchmark.national_avg_pension_wealth)}</div>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>Pensionsformue lige nu</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.85rem', color: '#666' }}>Forskel</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 600, color: above ? '#0a7d3e' : '#b00020' }}>
                    {above ? '+' : ''}{fmtDKK(diff)} ({above ? '+' : ''}{pct.toFixed(1)}%)
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#666' }}>
                Kilde: {benchmark.source}, {benchmark.year}. {benchmark.note}.
              </div>
            </>
          )
        })()}
      </section>

      <h2>Sager ({cases.length})</h2>
      {cases.length === 0 ? (
        <p>Ingen sager for dette medlem.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #92004D', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem' }}>Case ID</th>
              <th style={{ padding: '0.5rem' }}>Type</th>
              <th style={{ padding: '0.5rem' }}>Status</th>
              <th style={{ padding: '0.5rem' }}>Prioritet</th>
              <th style={{ padding: '0.5rem' }}>Oprettet</th>
              <th style={{ padding: '0.5rem' }}>SLA</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.case_id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.5rem' }}>{c.case_id}</td>
                <td style={{ padding: '0.5rem' }}>{c.case_type}</td>
                <td style={{ padding: '0.5rem' }}>{c.status}</td>
                <td style={{ padding: '0.5rem' }}>{c.priority}</td>
                <td style={{ padding: '0.5rem' }}>{c.created_at.slice(0, 10)}</td>
                <td style={{ padding: '0.5rem', color: c.breached_sla ? 'crimson' : 'inherit' }}>
                  {c.breached_sla ? 'Brudt' : `${c.sla_hours}t`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function App() {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: 1000, margin: '0 auto' }}>
      {selected ? (
        <MemberDetailView id={selected} onBack={() => setSelected(null)} />
      ) : (
        <MembersList onSelect={setSelected} />
      )}
    </main>
  )
}

export default App
