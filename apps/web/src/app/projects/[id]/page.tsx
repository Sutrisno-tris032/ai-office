"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  PHASES,
  PHASE_LABEL,
  PROJECT_KIND_LABEL,
  ROLE_LABEL,
  TERMS_VERSION,
  type Gate,
  type MessageAuthor,
  type Project,
} from "@ai-office/shared";
import { ConfidentialBadge, TopBar } from "@/components/TopBar";
import { api } from "@/lib/api";
import { useProject } from "@/lib/useProject";

const AUTHOR: Record<MessageAuthor, { name: string; initials: string; color: string }> = {
  client: { name: "Anda", initials: "", color: "" },
  consultant: { name: "Raka · AI Business Consultant", initials: "RK", color: "bg-ink" },
  analyst: { name: "Sinta · Business Analyst", initials: "SI", color: "bg-teal-700" },
  architect: { name: "Arya · Solution Architect", initials: "AR", color: "bg-purple-700" },
  pm: { name: "Bayu · Project Manager", initials: "BA", color: "bg-brand" },
  system: { name: "Sistem", initials: "", color: "" },
};

export default function ConsultPage() {
  const { id } = useParams<{ id: string }>();
  const { snap, typing, connected, error } = useProject(id);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // scrollIntoView kini mengembalikan Promise di Chrome; jangan dijadikan nilai kembali effect.
    void endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [snap?.messages.length, typing]);

  if (error) return <p className="p-10 text-red-700">{error}</p>;
  if (!snap) return <p className="p-10 text-muted">Memuat ruang konsultasi…</p>;
  const { project, messages } = snap;

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setDraft("");
    try {
      await api.send(id, text);
    } finally {
      setSending(false);
    }
  }

  const phaseIndex = PHASES.indexOf(project.phase);
  const inOffice = project.phase === "development" || project.phase === "completed";

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar>
        <ConfidentialBadge />
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${connected ? "bg-green-50 text-green-800" : "bg-slate-100 text-muted"}`}>
          <span className={`h-2 w-2 rounded-full ${connected ? "live-dot bg-green-600" : "bg-slate-400"}`} />
          {connected ? "Terhubung" : "Menghubungkan…"}
        </span>
        {inOffice && (
          <Link href={`/projects/${id}/office`} className="min-h-10 rounded-lg bg-ink px-3.5 py-2.5 text-sm font-bold text-white">
            Buka Virtual Office
          </Link>
        )}
      </TopBar>

      <div className="border-b border-line bg-white px-6 py-3">
        <div className="text-xs font-semibold text-muted">{PROJECT_KIND_LABEL[project.kind]}</div>
        <h1 className="text-lg font-extrabold">{project.name}</h1>
      </div>

      <div className="flex flex-1 flex-wrap">
        <aside aria-label="Tahapan proyek" className="w-full border-r border-line bg-white p-5 md:w-64">
          <div className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">Tahapan</div>
          <ol className="flex flex-col gap-1">
            {PHASES.filter((p) => p !== "planning").map((p, n) => {
              const i = PHASES.indexOf(p);
              const state = i < phaseIndex ? "done" : i === phaseIndex || (p === "plan_review" && project.phase === "planning") ? "active" : "todo";
              return (
                <li key={p} className={`flex items-center gap-3 rounded-lg p-2.5 ${state === "active" ? "bg-brand-soft" : ""}`}>
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      state === "done" ? "bg-green-700 text-white" : state === "active" ? "bg-brand text-white" : "border border-slate-300 text-muted"
                    }`}
                  >
                    {state === "done" ? "✓" : n + 1}
                  </span>
                  <span className="text-sm font-semibold">{PHASE_LABEL[p]}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-5 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-muted">
            Setiap persetujuan tercatat di audit trail dengan waktu, identitas, dan alamat IP.
          </p>
        </aside>

        <section aria-label="Percakapan" className="flex min-w-0 flex-[999_1_480px] flex-col">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
            {messages.map((m) =>
              m.author === "system" ? (
                <div key={m.id} className="self-center rounded-full bg-slate-200/70 px-3 py-1 text-center text-xs text-slate-700">
                  {m.content}
                </div>
              ) : m.author === "client" ? (
                <div key={m.id} className="max-w-[80%] self-end whitespace-pre-line rounded-2xl rounded-tr-sm bg-brand px-4 py-3 text-sm leading-relaxed text-white">
                  {m.content}
                </div>
              ) : (
                <div key={m.id} className="flex max-w-[85%] gap-3 self-start">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${AUTHOR[m.author].color}`}>
                    {AUTHOR[m.author].initials}
                  </span>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-muted">{AUTHOR[m.author].name}</span>
                    <div className="whitespace-pre-line rounded-2xl rounded-tl-sm border border-line bg-white px-4 py-3 text-sm leading-relaxed">{m.content}</div>
                  </div>
                </div>
              ),
            )}
            {typing && typing !== "client" && (
              <div className="flex items-center gap-2 self-start text-xs text-muted">
                <span className="typing inline-flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                </span>
                {AUTHOR[typing].name.split(" · ")[0]} sedang menulis…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={send} className="border-t border-line bg-white px-6 py-4">
            <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border border-slate-300 py-1.5 pl-4 pr-1.5">
              <label htmlFor="msg" className="sr-only">Tulis pesan</label>
              <input
                id="msg"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={4000}
                placeholder={project.phase === "planning" ? "Rencana sedang disusun…" : "Ceritakan kebutuhan Anda…"}
                className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none"
              />
              <button disabled={sending || !draft.trim()} aria-label="Kirim pesan" className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-white disabled:opacity-50">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
            <p className="mx-auto mt-2 max-w-3xl text-[11px] text-muted">Percakapan berlabel RAHASIA dan hanya bisa diakses pemilik proyek.</p>
          </form>
        </section>

        <aside aria-label="Ringkasan & persetujuan" className="flex w-full flex-col gap-5 border-l border-line bg-white p-5 lg:w-[380px]">
          <ApprovalCard project={project} />
          <Summary project={project} />
        </aside>
      </div>
    </div>
  );
}

function ApprovalCard({ project }: { project: Project }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gate = project.pendingGate;
  if (!gate) return null;

  const copy: Record<Gate, { title: string; body: string; cta: string }> = {
    solution: { title: "Setujui arah solusi", body: "Bila arah solusi sudah sesuai, setujui untuk lanjut ke Syarat & Ketentuan. Anda tetap bisa meminta perubahan lewat chat.", cta: "Setujui arah solusi" },
    terms: { title: `Syarat & Ketentuan v${TERMS_VERSION}`, body: "NDA dua arah, kode sumber milik klien, pemrosesan data sesuai UU PDP & ISO 27001, termin pembayaran sesuai kontrak.", cta: "Setuju & mulai analisis kebutuhan" },
    requirements: { title: "Setujui dokumen kebutuhan", body: "Architect dan PM akan menyusun tech stack, susunan tim, dan rencana kerja berdasarkan dokumen ini.", cta: "Setujui kebutuhan" },
    plan: { title: "Setujui rencana & mulai development", body: "Tim agent masuk kantor virtual dan mulai bekerja. Anda bisa memantau setiap task secara realtime.", cta: "Setujui & mulai development" },
  };
  const c = copy[gate];
  const needsCheck = gate === "terms";

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      await api.approve(project.id, gate!, gate === "terms" ? TERMS_VERSION : undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-brand bg-brand-soft/40 p-4">
      <div className="text-xs font-bold uppercase tracking-wider text-brand">Menunggu persetujuan Anda</div>
      <div className="text-base font-extrabold">{c.title}</div>
      <p className="text-sm leading-relaxed text-slate-700">{c.body}</p>
      {needsCheck && (
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#1e4fd8]" />
          Saya telah membaca dan menyetujui Syarat & Ketentuan serta Kebijakan Privasi.
        </label>
      )}
      <button
        onClick={approve}
        disabled={busy || (needsCheck && !checked)}
        className="min-h-11 rounded-xl bg-ink text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
      >
        {busy ? "Menyimpan…" : c.cta}
      </button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <p className="text-[11px] text-muted">Persetujuan dicatat: identitas, waktu, alamat IP{needsCheck ? ", dan versi dokumen" : ""}.</p>
    </div>
  );
}

function Summary({ project }: { project: Project }) {
  const facts = Object.entries(project.facts);
  return (
    <div className="flex flex-col gap-5">
      {facts.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Informasi terkumpul</h2>
          <dl className="flex flex-col gap-2">
            {facts.map(([k, v]) => (
              <div key={k} className="border-b border-slate-100 pb-2">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {project.solution && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Arah solusi</h2>
          <p className="mb-2 text-sm">{project.solution.summary}</p>
          <ul className="flex flex-col gap-2">
            {project.solution.modules.map((m) => (
              <li key={m.title} className="rounded-lg bg-slate-50 p-2.5">
                <div className="text-sm font-bold">{m.title}</div>
                <div className="text-xs text-muted">{m.description}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {project.requirements && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Kebutuhan (BRD)</h2>
          <div className="text-xs font-semibold text-muted">Peran pengguna</div>
          <p className="mb-2 text-sm">{project.requirements.userRoles.join(", ")}</p>
          <div className="text-xs font-semibold text-muted">Fungsional</div>
          <ul className="mb-2 list-disc pl-5 text-sm">{project.requirements.functional.map((f) => <li key={f}>{f}</li>)}</ul>
          <div className="text-xs font-semibold text-muted">Non-fungsional</div>
          <ul className="list-disc pl-5 text-sm">{project.requirements.nonFunctional.map((f) => <li key={f}>{f}</li>)}</ul>
        </section>
      )}
      {project.plan && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Rencana teknis</h2>
          <ul className="mb-3 flex flex-col gap-1.5">
            {project.plan.techStack.map((t) => (
              <li key={t.layer} className="text-sm">
                <span className="font-bold">{t.layer}:</span> {t.choice}
              </li>
            ))}
          </ul>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {project.plan.team.map((t) => (
              <span key={t.role} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">
                {t.count} {ROLE_LABEL[t.role]}
              </span>
            ))}
          </div>
          <div className="text-xs text-muted">{project.plan.tasks.length} task · {project.plan.milestones.length} milestone</div>
        </section>
      )}
    </div>
  );
}
