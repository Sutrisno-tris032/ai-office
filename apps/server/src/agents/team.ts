import { MAX_TEAM_SIZE, type Agent, type AgentLook, type Plan, type Role } from '@ai-office/shared';

const NAMES: Record<Role, string[]> = {
  PM: ['Bayu'],
  BE: ['Liu', 'Bagus', 'Bambang', 'Rizal', 'Yusuf'],
  FE: ['Andri', 'Clara', 'Angga', 'Putri', 'Kevin'],
  QA: ['Nadia', 'Sheva', 'Fajar'],
  OPS: ['Rizky', 'Hendra'],
  UI: ['Dewi', 'Sari'],
};

const LOOKS: Record<string, AgentLook> = {
  Bayu: { skin: '#E0AC7E', hair: '#1E1814', shirt: '#2E3A59', hairStyle: 'short' },
  Liu: { skin: '#F1CDA9', hair: '#15110E', shirt: '#6B8F71', hairStyle: 'long' },
  Bagus: { skin: '#B9794F', hair: '#1A1411', shirt: '#4A6FA5', hairStyle: 'short' },
  Bambang: { skin: '#A86B45', hair: '#3A3532', shirt: '#5E6B3A', hairStyle: 'short' },
  Rizal: { skin: '#C68B5E', hair: '#1E1814', shirt: '#7A5536', hairStyle: 'curly' },
  Yusuf: { skin: '#D7A07A', hair: '#2B1D14', shirt: '#33475B', hairStyle: 'short' },
  Andri: { skin: '#C68B5E', hair: '#1E1814', shirt: '#D9A441', hairStyle: 'curly' },
  Clara: { skin: '#F3D2B5', hair: '#6B4226', shirt: '#C0643F', hairStyle: 'bun' },
  Angga: { skin: '#D7A07A', hair: '#2B1D14', shirt: '#3B3F46', hairStyle: 'short' },
  Putri: { skin: '#E8B993', hair: '#1E1814', shirt: '#8E7CC3', hairStyle: 'hijab' },
  Kevin: { skin: '#F1CDA9', hair: '#3A2A20', shirt: '#2F7F7A', hairStyle: 'short' },
  Nadia: { skin: '#D9A27A', hair: '#1E1814', shirt: '#EDE3D1', hairStyle: 'hijab' },
  Sheva: { skin: '#E8B993', hair: '#4A2E1E', shirt: '#8E7CC3', hairStyle: 'long' },
  Fajar: { skin: '#B9794F', hair: '#1A1411', shirt: '#4F6B8A', hairStyle: 'short' },
  Rizky: { skin: '#C68B5E', hair: '#1E1814', shirt: '#2F7F7A', hairStyle: 'short' },
  Hendra: { skin: '#A86B45', hair: '#1E1814', shirt: '#5B6770', hairStyle: 'short' },
  Dewi: { skin: '#E0AC7E', hair: '#2B1D14', shirt: '#C9714F', hairStyle: 'long' },
  Sari: { skin: '#D9A27A', hair: '#1E1814', shirt: '#B97C7C', hairStyle: 'hijab' },
};

/**
 * Membentuk tim dari komposisi rencana: selalu tepat 1 PM, total maksimal 10.
 * Bila rencana meminta lebih, kuota dipangkas dari peran terbesar terlebih dulu.
 */
export function buildTeam(projectId: string, team: Plan['team']): Omit<Agent, 'id'>[] {
  const counts = new Map<Role, number>();
  for (const t of team) if (t.role !== 'PM') counts.set(t.role, Math.min((counts.get(t.role) ?? 0) + t.count, NAMES[t.role].length));
  let total = 1 + [...counts.values()].reduce((a, b) => a + b, 0);
  while (total > MAX_TEAM_SIZE) {
    const [biggest] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    counts.set(biggest![0], biggest![1] - 1);
    total--;
  }
  const order: Role[] = ['BE', 'FE', 'UI', 'QA', 'OPS'];
  const members: { name: string; role: Role }[] = [{ name: 'Bayu', role: 'PM' }];
  for (const role of order) for (let i = 0; i < (counts.get(role) ?? 0); i++) members.push({ name: NAMES[role][i]!, role });
  return members.map((m, seat) => ({
    projectId,
    name: m.name,
    role: m.role,
    status: 'idle',
    currentTaskId: null,
    seat,
    look: LOOKS[m.name] ?? LOOKS.Bayu!,
  }));
}
