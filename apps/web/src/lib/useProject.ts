"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { MessageAuthor, ProjectSnapshot, ServerEvent } from "@ai-office/shared";
import { api, wsUrl } from "./api";

type State = { snap: ProjectSnapshot | null; typing: MessageAuthor | null };

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

function reducer(state: State, e: ServerEvent): State {
  if (e.type === "snapshot") return { ...state, snap: e.data };
  if (e.type === "typing") return { ...state, typing: e.data.typing ? e.data.author : null };
  const s = state.snap;
  if (!s) return state;
  switch (e.type) {
    case "project":
      return { ...state, snap: { ...s, project: e.data } };
    case "message":
      return { snap: { ...s, messages: upsert(s.messages, e.data) }, typing: e.data.author === "client" ? state.typing : null };
    case "agent":
      return { ...state, snap: { ...s, agents: upsert(s.agents, e.data).sort((a, b) => a.seat - b.seat) } };
    case "task":
      return { ...state, snap: { ...s, tasks: upsert(s.tasks, e.data) } };
    case "activity":
      return { ...state, snap: { ...s, activities: [e.data, ...s.activities.filter((a) => a.id !== e.data.id)].slice(0, 80) } };
  }
}

/** State proyek realtime: snapshot awal + event WebSocket, dengan reconnect otomatis. */
export function useProject(projectId: string) {
  const [state, dispatch] = useReducer(reducer, { snap: null, typing: null });
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    api
      .snapshot(projectId)
      .then((snap) => dispatch({ type: "snapshot", data: snap }))
      .catch((e: Error) => setError(e.message));

    const connect = () => {
      ws = new WebSocket(wsUrl(projectId));
      ws.onopen = () => {
        retry.current = 0;
        setConnected(true);
      };
      ws.onmessage = (ev) => dispatch(JSON.parse(ev.data as string) as ServerEvent);
      ws.onclose = (ev) => {
        setConnected(false);
        if (closed || ev.code === 4401 || ev.code === 4403) return;
        retry.current += 1;
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry.current));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [projectId]);

  return { snap: state.snap, typing: state.typing, connected, error };
}
