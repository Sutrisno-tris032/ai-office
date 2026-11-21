"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { PHASE_LABEL, PROJECT_KIND_LABEL, type Project, type ProjectKind } from "@ai-office/shared";
import { AuthCard } from "@/components/AuthCard";
import { SecureBadge, TopBar } from "@/components/TopBar";
import { api, type User } from "@/lib/api";

const OPTIONS: { kind: ProjectKind; desc: string; eta: string; icon: string }[] = [
  { kind: "web", desc: "Portal pelanggan, dashboard, marketplace, atau aplikasi internal berbasis browser.", eta: "± 4–10 minggu", icon: "M3 4h18v14H3zM3 8h18M8 21h8M12 18v3" },
  { kind: "mobile", desc: "Aplikasi Android & iOS untuk pelanggan atau tim lapangan.", eta: "± 6–12 minggu", icon: "M7 2h10a1 1 0 011 1v18a1 1 0 01-1 1H7a1 1 0 01-1-1V3a1 1 0 011-1zM11 18h2" },
  { kind: "saas", desc: "Produk berlangganan dengan multi-tenant, billing, dan onboarding.", eta: "± 8–16 minggu", icon: "M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10" },
  { kind: "erp", desc: "Otomasi proses bisnis: inventori, keuangan, HR, approval berjenjang.", eta: "± 8–20 minggu", icon: "M4 5c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" },
  { kind: "integration", desc: "Hubungkan sistem yang ada, bangun API, atau otomasi alur kerja dengan AI.", eta: "± 2–6 minggu", icon: "M8 7h8a4 4 0 010 8h-1M16 17H8a4 4 0 010-8h1" },
  { kind: "idea", desc: "Ceritakan masalah bisnis Anda; konsultan AI membantu menentukan solusinya.", eta: "Gratis", icon: "M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0012 3z" },
];

const STEPS = [
  ["Konsultasi bisnis", "Konsultan AI menggali masalah dan mengusulkan arah solusi."],
  ["Syarat & Ketentuan", "NDA, kepemilikan kode, dan pemrosesan data dijelaskan."],
  ["Analisis kebutuhan", "Business Analyst menyusun dokumen kebutuhan (BRD)."],
  ["Rencana & tech stack", "Architect & PM menyusun stack, tim agent, dan task."],
  ["Development realtime", "Pantau tim agent bekerja di kantor virtual & Kanban."],
];

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const [picked, setPicked] = useState<ProjectKind | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);
  useEffect(() => {
    if (user) api.projects().then((r) => setProjects(r.projects)).catch(() => undefined);
  }, [user]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const { project } = await api.createProject(name, picked);
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar>
        {user && (
          <>
            <SecureBadge />
            <span className="text-sm font-semibold text-muted">{user.name}</span>
            <button
              onClick={() => api.logout().then(() => setUser(null))}
              className="min-h-10 rounded-lg border border-line px-3 text-sm font-semibold"
            >
              Keluar
            </button>
          </>
        )}
      </TopBar>

      <main className="mx-auto w-full max-w-[1280px] flex-1 px-6 py-12">
        <section className="flex flex-wrap items-start gap-10">
          <div className="flex max-w-2xl flex-1 basis-[420px] flex-col gap-4">
            <span className="inline-flex items-center gap-2 self-start rounded-full bg-brand-soft px-3 py-1.5 text-[13px] font-semibold text-brand">
              <span className="h-2 w-2 rounded-full bg-brand" /> Tim AI agent siap bekerja untuk proyek Anda
            </span>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">Apa yang ingin Anda bangun hari ini?</h1>
            <p className="text-lg leading-relaxed text-muted">
              Konsultan AI menggali kebutuhan bisnis Anda, menyusun solusi dan rencana teknis untuk Anda setujui, lalu tim agent membangunnya. Semua bisa dipantau langsung dari kantor virtual.
            </p>
          </div>
          {user === null && <AuthCard onDone={setUser} />}
        </section>

        {user && (
          <>
            <section aria-labelledby="pilih" className="mt-10">
              <h2 id="pilih" className="mb-4 text-sm font-bold uppercase tracking-wider text-muted">
                Pilih jenis proyek
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
                {OPTIONS.map((o) => (
                  <button
                    key={o.kind}
                    onClick={() => {
                      setPicked(o.kind);
                      setName("");
                    }}
                    aria-pressed={picked === o.kind}
                    className={`flex min-h-48 flex-col gap-3 rounded-2xl border bg-white p-6 text-left transition ${picked === o.kind ? "border-brand ring-2 ring-brand-soft" : "border-line hover:border-slate-300"}`}
                  >
                    <span className="flex items-center justify-between">
                      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d={o.icon} />
                        </svg>
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-muted">{o.eta}</span>
                    </span>
                    <span className="text-lg font-bold">{PROJECT_KIND_LABEL[o.kind]}</span>
                    <span className="text-sm leading-relaxed text-muted">{o.desc}</span>
                  </button>
                ))}
              </div>
            </section>

            {picked && (
              <form onSubmit={create} className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-brand bg-white p-5">
                <label className="flex min-w-[280px] flex-1 flex-col gap-1.5 text-sm font-semibold">
                  Nama proyek ({PROJECT_KIND_LABEL[picked]})
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    minLength={3}
                    maxLength={120}
                    required
                    placeholder="Contoh: Sistem reservasi klinik gigi multi-cabang"
                    className="rounded-xl border border-slate-300 px-3.5 py-2.5 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft"
                  />
                </label>
                <button disabled={busy} className="min-h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white disabled:opacity-60">
                  {busy ? "Menyiapkan…" : "Mulai konsultasi →"}
                </button>
                {error && <p role="alert" className="w-full text-sm text-red-700">{error}</p>}
              </form>
            )}

            {projects.length > 0 && (
              <section className="mt-12">
                <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted">Proyek saya</h2>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
                  {projects.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={p.phase === "development" || p.phase === "completed" ? `/projects/${p.id}/office` : `/projects/${p.id}`}
                        className="flex flex-col gap-1 rounded-xl border border-line bg-white p-4 hover:border-slate-300"
                      >
                        <span className="text-xs font-semibold text-muted">{PROJECT_KIND_LABEL[p.kind]}</span>
                        <span className="font-bold">{p.name}</span>
                        <span className="text-xs font-semibold text-brand">{PHASE_LABEL[p.phase]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <section className="mt-14 rounded-2xl border border-line bg-white p-8">
          <h2 className="text-xl font-extrabold">Cara kerja AI Office</h2>
          <p className="mt-1 text-sm text-muted">Setiap tahap butuh persetujuan Anda sebelum lanjut.</p>
          <ol className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50 p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">{i + 1}</span>
                <span className="font-bold">{t}</span>
                <span className="text-[13px] leading-relaxed text-muted">{d}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-6 grid gap-4 rounded-2xl bg-ink p-8 text-white md:grid-cols-[1fr_2fr]">
          <div>
            <span className="rounded-full border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-300">ISO/IEC 27001:2022</span>
            <h2 className="mt-3 text-2xl font-extrabold">Ide bisnis Anda terlindungi sejak percakapan pertama</h2>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
            {[
              ["A.8.24 · Kriptografi", "TLS saat transit, hash scrypt untuk kata sandi, token sesi di-hash."],
              ["A.5.15 · Kontrol akses", "Hanya pemilik proyek yang bisa membuka data proyeknya."],
              ["A.8.15 · Logging", "Audit trail berantai hash, append-only di database."],
              ["A.5.12 · Klasifikasi", "Setiap proyek otomatis berlabel RAHASIA."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
                <div className="text-xs font-bold tracking-wider text-blue-300">{t}</div>
                <div className="mt-1 text-sm text-slate-300">{d}</div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
