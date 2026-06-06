import React, { useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { LeaguesSection } from './Leagues';

type Group = { id: number; grade_id: number; name: string; allow_student_send: boolean };
type Message = { id: number; group_id: number; sender_id: number | null; text: string; created_at: string; sender_name?: string };

const API_BASE = '/api';

function useAuthSocket(): Socket | null {
  const token = localStorage.getItem('Authorization')?.replace(/^Bearer\s+/i, '') || localStorage.getItem('token');
  const socket = useMemo(() => {
    if (!token) return null;
    const s = io('/', {
      path: '/socket.io',
      withCredentials: true,
      auth: { token },
      transports: ['websocket'],
    });
    return s;
  }, [token]);
  useEffect(() => {
    return () => {
      socket?.disconnect();
    };
  }, [socket]);
  return socket;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('Authorization') || localStorage.getItem('token');
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token?.startsWith('Bearer') ? token : token ? `Bearer ${token}` : '',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function App() {
  const socket = useAuthSocket();
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [canSend, setCanSend] = useState(true);
  const [view, setView] = useState<'chat' | 'leagues'>('chat');

  useEffect(() => {
    api<{ groups: Group[] }>('/chat/groups').then((d) => {
      setGroups(d.groups);
      if (!activeGroup && d.groups.length) setActiveGroup(d.groups[0]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeGroup) return;
    api<{ messages: Message[] }>(`/chat/groups/${activeGroup.id}/history?limit=50`).then((d) => {
      setMessages(d.messages);
      setCanSend(activeGroup.allow_student_send);
    }).catch(() => {});
    socket?.emit('chat:join-group', activeGroup.id);
  }, [activeGroup, socket]);

  useEffect(() => {
    if (!socket) return;
    const onNew = (msg: Message) => {
      if (activeGroup && msg.group_id === activeGroup.id) setMessages((m) => [...m, msg]);
    };
    const onPerm = (p: { groupId: number; allow_student_send: boolean }) => {
      if (activeGroup && p.groupId === activeGroup.id) setCanSend(p.allow_student_send);
    };
    socket.on('chat:new-message', onNew);
    socket.on('chat:permission-changed', onPerm);
    return () => {
      socket.off('chat:new-message', onNew);
      socket.off('chat:permission-changed', onPerm);
    };
  }, [socket, activeGroup]);

  const send = () => {
    if (!socket || !activeGroup || !text.trim()) return;
    socket.emit('chat:send', { groupId: activeGroup.id, text: text.trim() });
    setText('');
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif' }}>
      <nav style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid #eee' }}>
        <button onClick={() => setView('chat')} style={{ fontWeight: view === 'chat' ? 700 : 400 }}>Chat</button>
        <button onClick={() => setView('leagues')} style={{ fontWeight: view === 'leagues' ? 700 : 400 }}>Leagues</button>
      </nav>
      {view === 'chat' ? (
        <div style={{ display: 'flex', flex: 1 }}>
          <aside style={{ width: 300, borderRight: '1px solid #eee', padding: 12 }}>
            <h3>Groups</h3>
            {groups.map((g) => (
              <div key={g.id} style={{ padding: 8, cursor: 'pointer', background: activeGroup?.id === g.id ? '#f0f0f0' : 'transparent' }} onClick={() => setActiveGroup(g)}>
                {g.name}
              </div>
            ))}
          </aside>
          <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <header style={{ padding: 12, borderBottom: '1px solid #eee' }}>
              <strong>{activeGroup?.name || 'Select a group'}</strong>
            </header>
            <div style={{ flex: 1, padding: 12, overflowY: 'auto' }}>
              {messages.map((m) => (
                <div key={m.id} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: '#666' }}>{m.sender_name || m.sender_id}</div>
                  <div>{m.text}</div>
                  <div style={{ fontSize: 11, color: '#aaa' }}>{new Date(m.created_at).toLocaleString()}</div>
                </div>
              ))}
            </div>
            <footer style={{ padding: 12, borderTop: '1px solid #eee', display: 'flex', gap: 8 }}>
              <input style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={canSend ? 'Type a message' : 'Sending disabled by teacher'} disabled={!canSend} />
              <button onClick={send} disabled={!canSend || !text.trim()}>Send</button>
            </footer>
          </main>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <LeaguesSection />
        </div>
      )}
    </div>
  );
}



