import React, { useEffect, useMemo, useState } from 'react';

type Grade = { id: number; name: string };
type League = {
  id: number;
  name: string;
  grade_id: number;
  grade_name?: string;
  image_url?: string | null;
  matches_count: number;
  start_date: string;
  end_date: string;
  description?: string | null;
  price?: number | null;
};

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('Authorization') || localStorage.getItem('token');
  return token ? { Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}` } : {};
}

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function LeagueAdminForm(props: { onCreated?: (league: League) => void }) {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [name, setName] = useState('');
  const [gradeId, setGradeId] = useState<number | ''>('');
  const [matches, setMatches] = useState<number | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState<string>('');
  const [image, setImage] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  useEffect(() => {
    fetchJSON<{ grades: Grade[] }>('/utils/grades')
      .then((d) => setGrades(d.grades))
      .catch(() => setGrades([]));
  }, []);

  const isValid = useMemo(() => {
    if (!name.trim() || !gradeId || !matches || !startDate || !endDate) return false;
    if (new Date(endDate) <= new Date(startDate)) return false;
    if (price && isNaN(Number(price))) return false;
    return true;
  }, [name, gradeId, matches, startDate, endDate, price]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!isValid) {
      setError('Please fill required fields correctly.');
      return;
    }
    try {
      setSubmitting(true);
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('grade_id', String(gradeId));
      fd.append('matches_count', String(matches));
      fd.append('start_date', startDate);
      fd.append('end_date', endDate);
      if (description) fd.append('description', description);
      if (price !== '') fd.append('price', String(Number(price)));
      if (image) fd.append('image', image);

      const res = await fetch('/api/leagues', {
        method: 'POST',
        headers: { ...authHeader() },
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      const created: League = await res.json();
      setSuccess('League created successfully');
      setName('');
      setGradeId('');
      setMatches('');
      setStartDate('');
      setEndDate('');
      setDescription('');
      setPrice('');
      setImage(null);
      props.onCreated?.(created);
    } catch (err: any) {
      setError(err?.message || 'Failed to create league');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
      <h3>Create League</h3>
      {error && <div style={{ color: '#c00' }}>{error}</div>}
      {success && <div style={{ color: '#0a0' }}>{success}</div>}
      <label>
        <div>Name *</div>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        <div>Grade *</div>
        <select value={gradeId} onChange={(e) => setGradeId(e.target.value ? Number(e.target.value) : '')} required>
          <option value="">Select grade</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </label>
      <label>
        <div>Number of matches *</div>
        <input type="number" min={1} value={matches} onChange={(e) => setMatches(e.target.value ? Number(e.target.value) : '')} required />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label>
          <div>Start date *</div>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>
        <label>
          <div>End date *</div>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
        </label>
      </div>
      <label>
        <div>Description</div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </label>
      <label>
        <div>Price (leave empty for Free)</div>
        <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g., 9.99" />
      </label>
      <label>
        <div>Image</div>
        <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] || null)} />
      </label>
      <button type="submit" disabled={!isValid || submitting}>{submitting ? 'Creating…' : 'Create League'}</button>
    </form>
  );
}

export function LeagueList() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/leagues', { headers: { ...authHeader() } });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setLeagues(Array.isArray(data) ? data : data?.data || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load leagues');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>Leagues</h3>
        <button onClick={load}>Refresh</button>
      </div>
      {loading && <div>Loading…</div>}
      {error && <div style={{ color: '#c00' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {leagues.map((l) => (
          <div key={l.id} style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ width: '100%', position: 'relative', paddingTop: '56.25%' }}>
              {l.image_url ? (
                <img src={l.image_url} alt={l.name} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>No image</div>
              )}
            </div>
            <div style={{ padding: 12, display: 'grid', gap: 4 }}>
              <div style={{ fontWeight: 600 }}>{l.name}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{l.grade_name || `Grade #${l.grade_id}`}</div>
              <div style={{ fontSize: 12 }}>
                {new Date(l.start_date).toLocaleDateString()} — {new Date(l.end_date).toLocaleDateString()}
              </div>
              <div style={{ fontSize: 12 }}>Matches: {l.matches_count}</div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{l.price != null ? `${l.price} EGP` : 'Free'}</div>
              {l.description && <div style={{ fontSize: 12, color: '#444' }}>{l.description}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LeaguesSection() {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div style={{ padding: 16, display: 'grid', gap: 24 }}>
      <LeagueAdminForm onCreated={() => setReloadKey((k) => k + 1)} />
      <div key={reloadKey}>
        <LeagueList />
      </div>
    </div>
  );
}


