"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { PHASE_LABEL, ROLE_LABEL, type Agent, type Task, type TaskStatus } from "@ai-office/shared";
import { OfficeCanvas } from "@/components/OfficeCanvas";
import { ConfidentialBadge, TopBar } from "@/components/TopBar";
import { useProject } from "@/lib/useProject";

const COLUMNS: { key: TaskStatus; label: string; color: string }[] = [
  { key: "todo", label: "To Do", color: "#556070" },
  { key: "in_progress", label: "In Progress", color: "#1e4fd8" },
  { key: "in_review", label: "In Review", color: "#b45309" },
  { key: "done", label: "Done", color: "#15803d" },
];

const STATUS: Record<Agent["status"], { label: string; cls: string }> = {
  working: { label: "Bekerja", cls: "bg-green-50 text-green-800" },
  reviewing: { label: "Review", cls: "bg-orange-50 text-amber-800" },
  meeting: { label: "Koordinasi", cls: "bg-brand-soft text-brand-dark" },
  idle: { label: "Menunggu", cls: "bg-slate-100 text-slate-700" },
};

const ROLE_TINT: Record<Agent["role"], string> = {
  PM: "bg-ink",
  BE: "bg-brand",
  FE: "bg-purple-700",
  QA: "bg-amber-700",
  OPS: "bg-teal-700",
  UI: "bg-pink-700",
};

const CAPACITY_HOURS = 40;

export default function OfficePage() {
  const { id } = useParams<{ id: string }>();
  const { snap, connected, error } = useProject(id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterMine, setFilterMine] = useState(false);

  const agents = useMemo(() => snap?.agents ?? [], [snap?.agents]);
  const tasks = useMemo(() => snap?.tasks ?? [], [snap?.tasks]);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const load = useMemo(() => {
    const m = new Map<string, number>(agents.map((a) => [a.id, 0]));
    for (const t of tasks) if (t.assigneeId && t.status !== "done") m.set(t.assigneeId, (m.get(t.assigneeId) ?? 0) + t.estimateHours);
    return m;
  }, [agents, tasks]);

  if (error) return <p className="p-10 text-red-700">{error}</p>;
  if (!snap) return <p className="p-10 text-muted">Membuka kantor virtual…</p>;
  const { project, activities } = snap;

  if (!agents.length) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-lg font-bold">Kantor belum dibuka</p>
        <p className="text-muted">Tim agent masuk kantor setelah rencana disetujui. Fase saat ini: {PHASE_LABEL[project.phase]}.</p>
        <Link href={`/projects/${id}`} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-bold text-white">
          Kembali ke ruang konsultasi
        </Link>
      </div>
    );
  }

  const selected = (selectedId && byId.get(selectedId)) || agents[0]!;
  const done = tasks.filter((t) => t.status === "done").length;
  const parallel = tasks.filter((t) => t.status === "in_progress").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const counts = {
    working: agents.filter((a) => a.status === "working").length,
    reviewing: agents.filter((a) => a.status === "reviewing").length,
    idle: agents.filter((a) => a.status === "idle" || a.status === "meeting").length,
  };
  const shown = filterMine ? tasks.filter((t) => t.assigneeId === selected.id || t.reviewerId === selected.id) : tasks;
  const selTask = tasks.find((t) => t.id === selected.currentTaskId);
  const selLoad = Math.round(((load.get(selected.id) ?? 0) / CAPACITY_HOURS) * 100);
  const maxLoad = Math.max(0, ...[...load.values()].map((h) => Math.round((h / CAPACITY_HOURS) * 100)));

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar>
        <ConfidentialBadge />
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${connected ? "bg-green-50 text-green-800" : "bg-slate-100 text-muted"}`}>
          <span className={`h-2 w-2 rounded-full ${connected ? "live-dot bg-green-600" : "bg-slate-400"}`} />
          {connected ? `LIVE · ${agents.length} agent` : "Menghubungkan…"}
        </span>
        <Link href={`/projects/${id}`} className="min-h-10 rounded-lg border border-line px-3.5 py-2.5 text-sm font-semibold">
          Chat dengan PM
        </Link>
      </TopBar>

      <div className="flex flex-wrap items-end gap-4 border-b border-line bg-white px-6 py-3">
        <div className="min-w-[260px] flex-1">
          <div className="text-xs font-semibold text-muted">{PHASE_LABEL[project.phase]}</div>
          <h1 className="text-lg font-extrabold">{project.name}</h1>
        </div>
        {[
          ["Progres", `${pct}%`, `${done} dari ${tasks.length} task`],
          ["Paralel berjalan", String(parallel), "task In Progress"],
          ["Beban tertinggi", `${maxLoad}%`, maxLoad > 80 ? "Melewati batas 80%" : "Di bawah batas 80%"],
        ].map(([l, v, s]) => (
          <div key={l} className="rounded-xl border border-line px-4 py-2">
            <div className="text-[11px] font-semibold text-muted">{l}</div>
            <div className="text-xl font-extrabold">{v}</div>
            <div className="text-[11px] text-muted">{s}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-1 flex-wrap items-start gap-4 p-4">
        <section aria-label="Kantor virtual isometrik" className="relative h-[calc(100vh-190px)] min-h-[560px] min-w-0 flex-[999_1_640px] overflow-hidden rounded-2xl border border-sky-200 lg:sticky lg:top-4">
          <OfficeCanvas agents={agents} tasks={tasks} selectedId={selected.id} onSelect={setSelectedId} />
          <div className="pointer-events-none absolute left-3 top-3 rounded-xl bg-white/95 px-3 py-2 shadow-sm">
            <div className="text-[11px] font-extrabold tracking-wider text-muted">STATUS TIM</div>
            <div className="mt-1 flex gap-3 text-xs font-bold">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-green-600" />{counts.working} bekerja</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-600" />{counts.reviewing} review</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-slate-400" />{counts.idle} lainnya</span>
            </div>
          </div>
          <ol aria-label="Aktivitas terbaru" className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-2">
            {activities.slice(0, 3).map((a, i) => (
              <li key={a.id} className={`min-w-[200px] flex-1 rounded-xl border px-3 py-2 text-xs leading-snug shadow-sm ${i === 0 ? "border-blue-200 bg-brand-soft" : "border-line bg-white/95"}`}>
                <span className="mr-1.5 font-bold text-muted">{new Date(a.createdAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                {a.text}
              </li>
            ))}
          </ol>
        </section>

        <aside className="flex w-full flex-col gap-4 lg:w-[460px]">
          <div className="rounded-2xl border border-line bg-white p-4">
            <div className="flex items-center gap-3">
              <span className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-extrabold text-white ${ROLE_TINT[selected.role]}`}>
                {selected.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="flex-1">
                <div className="text-base font-extrabold">{selected.name}</div>
                <div className="text-xs text-muted">{agents.length === 1 ? "Full-stack Agent (merangkap PM)" : ROLE_LABEL[selected.role]}</div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS[selected.status].cls}`}>{STATUS[selected.status].label}</span>
            </div>
            <div className="mt-3 rounded-xl bg-slate-50 p-3">
              <div className="text-[11px] font-bold tracking-wider text-muted">SEDANG DIKERJAKAN</div>
              <div className="mt-1 text-sm font-bold">{selTask ? `${selTask.code} · ${selTask.title}` : selected.status === "meeting" ? "Koordinasi & alokasi task tim" : "—"}</div>
              {selTask && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-2 flex-1 rounded-full bg-slate-200">
                    <div className="h-2 rounded-full bg-brand transition-all" style={{ width: `${selTask.progress}%` }} />
                  </div>
                  <span className="text-xs font-bold tabular-nums">{selTask.progress}%</span>
                </div>
              )}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Stat label="Beban kerja" value={`${selLoad}%`} warn={selLoad > 80} />
              <Stat label="Task aktif" value={String(tasks.filter((t) => t.assigneeId === selected.id && t.status !== "done").length)} />
              <Stat label="Selesai" value={String(tasks.filter((t) => t.assigneeId === selected.id && t.status === "done").length)} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  aria-pressed={a.id === selected.id}
                  className={`min-h-9 rounded-full border px-2.5 text-xs font-semibold ${a.id === selected.id ? "border-brand bg-brand-soft text-brand-dark" : "border-line"}`}
                >
                  {a.name} · {a.role}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 rounded-2xl border border-line bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-extrabold">Kanban</h2>
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input type="checkbox" checked={filterMine} onChange={(e) => setFilterMine(e.target.checked)} className="h-4 w-4 accent-[#1e4fd8]" />
                Hanya task {selected.name}
              </label>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {COLUMNS.map((c) => {
                const list = shown.filter((t) => t.status === c.key);
                return (
                  <div key={c.key} className="flex max-h-[520px] min-h-[300px] flex-col gap-1.5 overflow-y-auto rounded-xl bg-slate-50 p-1.5">
                    <div className="flex justify-between px-1 pb-1 text-[11px] font-extrabold" style={{ color: c.color }}>
                      <span>{c.label}</span>
                      <span>{list.length}</span>
                    </div>
                    {list.map((t) => (
                      <TaskCard key={t.id} task={t} owner={t.assigneeId ? byId.get(t.assigneeId) : undefined} color={c.color} highlight={t.assigneeId === selected.id} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-100 p-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`text-base font-extrabold ${warn ? "text-red-700" : ""}`}>{value}</div>
    </div>
  );
}

function TaskCard({ task, owner, color, highlight }: { task: Task; owner?: Agent; color: string; highlight: boolean }) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-lg bg-white p-1.5 ${highlight ? "border-2 border-brand" : "border border-line"}`}
      style={{ boxShadow: `inset 0 3px 0 ${color}` }}
      title={task.description}
    >
      <span className="text-[10px] font-bold text-muted">
        {task.code}
        {task.priority === "high" && <span className="ml-1 text-red-700">●</span>}
      </span>
      <span className="text-[11px] font-semibold leading-snug">{task.title}</span>
      {task.dependsOn.length > 0 && task.status === "todo" && <span className="text-[10px] text-amber-800">Menunggu {task.dependsOn.join(", ")}</span>}
      <div className="flex items-center justify-between">
        {owner ? (
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-extrabold text-white ${ROLE_TINT[owner.role]}`}>{owner.name.slice(0, 2).toUpperCase()}</span>
        ) : (
          <span className="text-[10px] text-muted">{task.role}</span>
        )}
        {task.status === "in_progress" && <span className="text-[10px] font-bold tabular-nums text-brand-dark">{task.progress}%</span>}
      </div>
    </div>
  );
}
