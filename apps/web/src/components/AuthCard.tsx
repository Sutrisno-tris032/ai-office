"use client";

import { useState, type FormEvent } from "react";
import { api, type User } from "@/lib/api";

export function AuthCard({ onDone }: { onDone: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = mode === "register" ? await api.register(email, password, name) : await api.login(email, password);
      onDone(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft";

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-line bg-white p-6 shadow-sm">
      <div role="tablist" aria-label="Masuk atau daftar" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        {(["register", "login"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`min-h-10 rounded-lg text-sm font-bold ${mode === m ? "bg-white shadow-sm" : "text-muted"}`}
          >
            {m === "register" ? "Daftar" : "Masuk"}
          </button>
        ))}
      </div>
      {mode === "register" && (
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Nama
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Email
        <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Kata sandi
        <input
          className={input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={10}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
        />
        {mode === "register" && <span className="text-xs font-normal text-muted">Minimal 10 karakter.</span>}
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          {error}
        </p>
      )}
      <button disabled={busy} className="min-h-11 rounded-xl bg-ink text-sm font-bold text-white disabled:opacity-60">
        {busy ? "Memproses…" : mode === "register" ? "Buat akun & mulai" : "Masuk"}
      </button>
      <p className="text-xs leading-relaxed text-muted">
        Dengan melanjutkan, Anda menyetujui Kebijakan Privasi (UU PDP). Sesi dilindungi cookie httpOnly dan penguncian akun otomatis.
      </p>
    </form>
  );
}
