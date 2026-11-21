import type { Plan, PlanTask, Project } from '@ai-office/shared';

/** Rencana templat untuk mode offline (tanpa API key). Tetap DAG valid & berisi task paralel. */
export function mockPlan(project: Project): Plan {
  const mobile = project.kind === 'mobile';
  const t = (
    n: number,
    title: string,
    role: PlanTask['role'],
    dependsOn: number[] = [],
    priority: PlanTask['priority'] = 'medium',
    estimateHours = 8,
  ): PlanTask => ({
    code: `T-${String(n).padStart(2, '0')}`,
    title,
    description: `${title} untuk ${project.name}.`,
    role,
    priority,
    dependsOn: dependsOn.map((d) => `T-${String(d).padStart(2, '0')}`),
    estimateHours,
  });

  const tasks: PlanTask[] = [
    t(1, 'Setup repo, CI/CD & secret scanning', 'OPS', [], 'high', 6),
    t(2, 'Arsitektur, ADR & threat model', 'PM', [], 'high', 6),
    t(3, 'Desain UI & design system', 'UI', [], 'high', 10),
    t(4, 'Skema database & migrasi', 'BE', [2], 'high', 8),
    t(5, 'Autentikasi, MFA & RBAC', 'BE', [4], 'high', 12),
    t(6, 'API modul inti', 'BE', [4], 'high', 14),
    t(7, mobile ? 'Kerangka aplikasi mobile & navigasi' : 'Kerangka frontend & routing', 'FE', [3], 'high', 8),
    t(8, 'Halaman pengguna inti', 'FE', [6, 7], 'medium', 12),
    t(9, 'Dashboard admin & laporan', 'FE', [6, 7], 'medium', 12),
    t(10, 'Notifikasi & otomasi', 'BE', [6], 'medium', 8),
    t(11, 'Test plan & test case', 'QA', [2], 'medium', 6),
    t(12, 'Security testing (OWASP) & pentest ringan', 'QA', [5, 11], 'high', 8),
    t(13, 'Uji regresi end-to-end', 'QA', [8, 9, 10, 12], 'medium', 8),
    t(14, 'Monitoring, logging & backup', 'OPS', [1, 6], 'medium', 6),
    t(15, 'Rilis staging & demo klien', 'PM', [13, 14], 'high', 4),
  ];

  return {
    techStack: [
      { layer: 'Frontend', choice: mobile ? 'React Native (Expo)' : 'Next.js + TypeScript', reason: 'Ekosistem matang, cepat dikembangkan, SEO & performa baik' },
      { layer: 'Backend', choice: 'Node.js (Fastify) + TypeScript', reason: 'Satu bahasa end-to-end, performa tinggi' },
      { layer: 'Database', choice: 'PostgreSQL', reason: 'Transaksional, andal, mendukung JSONB' },
      { layer: 'Infrastruktur', choice: 'Docker + cloud region Jakarta', reason: 'Latensi rendah & kepatuhan lokasi data' },
      { layer: 'Keamanan', choice: 'OIDC + MFA, WAF, KMS', reason: 'Selaras kontrol ISO 27001 Annex A' },
    ],
    architecture: 'Modular monolith dengan API REST, frontend terpisah, PostgreSQL terkelola, antrian job untuk notifikasi, dan observability terpusat.',
    team: [
      { role: 'PM', count: 1 },
      { role: 'BE', count: 2 },
      { role: 'FE', count: 2 },
      { role: 'UI', count: 1 },
      { role: 'QA', count: 1 },
      { role: 'OPS', count: 1 },
    ],
    tasks,
    milestones: [
      { name: 'Fondasi', deliverables: ['Repo & CI/CD', 'Arsitektur & desain', 'Database'] },
      { name: 'Fitur inti', deliverables: ['Autentikasi', 'API inti', 'Halaman pengguna & admin'] },
      { name: 'Kualitas & rilis', deliverables: ['Security testing', 'Uji regresi', 'Demo staging'] },
    ],
  };
}
