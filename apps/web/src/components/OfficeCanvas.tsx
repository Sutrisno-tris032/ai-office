"use client";

import { useEffect, useRef } from "react";
import type { Agent, Task } from "@ai-office/shared";
import type { OfficeRenderer } from "@/lib/office/renderer";

export function OfficeCanvas({
  agents,
  tasks,
  selectedId,
  onSelect,
}: {
  agents: Agent[];
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<OfficeRenderer | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    void import("@/lib/office/renderer").then(({ OfficeRenderer }) => {
      if (cancelled || !host.current) return;
      renderer.current = new OfficeRenderer(host.current, { onSelect: (id) => select.current(id) });
    });
    return () => {
      cancelled = true;
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (renderer.current) {
        void renderer.current.update(agents, tasks, selectedId);
        clearInterval(id);
      }
    }, 50);
    if (renderer.current) void renderer.current.update(agents, tasks, selectedId);
    return () => clearInterval(id);
  }, [agents, tasks, selectedId]);

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0" />
      <div className="absolute right-3 top-3 flex gap-1.5 rounded-xl border border-white/60 bg-white/90 p-1.5 shadow-sm">
        <button aria-label="Perkecil" onClick={() => renderer.current?.setZoom(1 / 1.15)} className="h-10 w-10 rounded-lg border border-line bg-white text-lg font-bold">
          −
        </button>
        <button aria-label="Perbesar" onClick={() => renderer.current?.setZoom(1.15)} className="h-10 w-10 rounded-lg border border-line bg-white text-lg font-bold">
          +
        </button>
      </div>
    </div>
  );
}
