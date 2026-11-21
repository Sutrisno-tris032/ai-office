import { Application, Container, Graphics, Text } from "pixi.js";
import type { Agent, Task } from "@ai-office/shared";

/**
 * Renderer kantor virtual isometrik (PixiJS v8), terinspirasi gaya ilustrasi
 * kantor isometrik: lantai abu muda, dinding putih bertepi tebal, ruang meeting kaca,
 * pantry, lounge, dan meja kerja berpartisi biru. Jumlah meja mengikuti ukuran tim (1–10).
 */

const TW = 64;
const TH = 32;
const W = 18; // lebar ruangan (tile, sumbu x)
const D = 13; // kedalaman ruangan (tile, sumbu y)
const WALL_H = 120;

type Pt = [number, number];
const iso = (x: number, y: number, z = 0): Pt => [(x - y) * (TW / 2), (x + y) * (TH / 2) - z];
const flat = (pts: Pt[]) => pts.flat();

const C = {
  bg: 0x8cc8f5,
  floor: 0xdcdee1,
  floorLine: 0xc9ccd1,
  slabLeft: 0xbcc1c7,
  slabRight: 0xa6acb4,
  wallBack: 0xeeece8,
  wallLeft: 0xe3e0db,
  wallCap: 0xffffff,
  accent: 0x4f7ba6,
  wood: 0xd8b48a,
  woodSide: 0xb9956c,
  woodFront: 0xc6a378,
  dark: 0x3a4150,
  darkSide: 0x2c323d,
  darkFront: 0x333a46,
  partition: 0x587ba3,
  partitionSide: 0x46658a,
  glass: 0xbfe0f7,
  frame: 0x2b3547,
  green: 0x5a8b4e,
  greenDark: 0x3f6b3a,
  sofa: 0x6e8a4e,
  sofaSide: 0x58713e,
  chairBlue: 0x3f5f8f,
  white: 0xffffff,
};

function box(g: Graphics, x: number, y: number, z: number, w: number, d: number, h: number, top: number, front: number, side: number, alpha = 1) {
  g.poly(flat([iso(x, y + d, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x, y + d, z + h)])).fill({ color: front, alpha });
  g.poly(flat([iso(x + w, y, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x + w, y, z + h)])).fill({ color: side, alpha });
  g.poly(flat([iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)])).fill({ color: top, alpha });
}

/** Posisi kursi (koordinat tile). Index 0 = meja PM. */
const DESKS: Pt[] = [
  [1.2, 2.2],
  [2.0, 5.6],
  [5.4, 5.6],
  [8.8, 5.6],
  [2.0, 8.2],
  [5.4, 8.2],
  [8.8, 8.2],
  [2.0, 10.6],
  [5.4, 10.6],
  [8.8, 10.6],
];
const MEETING: Pt[] = [
  [11.0, 1.0],
  [12.3, 1.0],
  [13.6, 1.0],
  [11.0, 3.6],
  [12.3, 3.6],
  [13.6, 3.6],
];
const DESK_H = 30;

interface Person {
  agent: Agent;
  root: Container;
  body: Container;
  bubble: Container;
  bubbleBg: Graphics;
  label: Text;
  status: Text;
  ring: Graphics;
  monitorGlow: Graphics | null;
  pos: Pt; // posisi kini (tile)
  target: Pt;
}

export interface OfficeCallbacks {
  onSelect: (agentId: string) => void;
}

export class OfficeRenderer {
  private app = new Application();
  private world = new Container();
  private objects = new Container();
  private overlay = new Container();
  private people = new Map<string, Person>();
  private deskCount = -1;
  private zoom = 1;
  private destroyed = false;
  private ready: Promise<void>;
  private selectedId: string | null = null;

  constructor(
    private host: HTMLElement,
    private cb: OfficeCallbacks,
  ) {
    this.ready = this.init();
  }

  private async init() {
    await this.app.init({
      background: C.bg,
      resizeTo: this.host,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.app.canvas.setAttribute("aria-hidden", "true");
    this.host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.objects.sortableChildren = true;
    this.drawRoom();
    this.world.addChild(this.objects);
    this.overlay.sortableChildren = true;
    this.world.addChild(this.overlay);
    this.enablePan();
    this.fit();
    this.app.renderer.on("resize", () => this.fit());
    this.app.ticker.add((t) => this.animate(t.lastTime));
  }

  /* ---------------- Ruangan statis ---------------- */

  private add(g: Graphics, sortKey: number) {
    g.zIndex = sortKey * 10;
    this.objects.addChild(g);
  }

  private drawRoom() {
    const g = new Graphics();
    // pelat dasar
    g.poly(flat([iso(0, D), iso(W, D), iso(W, D, -18), iso(0, D, -18)])).fill(C.slabLeft);
    g.poly(flat([iso(W, 0), iso(W, D), iso(W, D, -18), iso(W, 0, -18)])).fill(C.slabRight);
    g.poly(flat([iso(0, 0), iso(W, 0), iso(W, D), iso(0, D)])).fill(C.floor);
    for (let x = 1; x < W; x++) g.moveTo(...iso(x, 0)).lineTo(...iso(x, D)).stroke({ width: 1, color: C.floorLine, alpha: 0.6 });
    for (let y = 1; y < D; y++) g.moveTo(...iso(0, y)).lineTo(...iso(W, y)).stroke({ width: 1, color: C.floorLine, alpha: 0.6 });
    // lantai ruang meeting sedikit lebih gelap
    g.poly(flat([iso(9.6, 0), iso(15, 0), iso(15, 4.6), iso(9.6, 4.6)])).fill({ color: 0xc9ccd1, alpha: 0.6 });
    // karpet lounge
    g.poly(flat([iso(13, 8.4), iso(17.6, 8.4), iso(17.6, 12.4), iso(13, 12.4)])).fill({ color: 0xc9b8a0, alpha: 0.7 });

    // dinding belakang (y = 0) & kiri (x = 0)
    g.poly(flat([iso(0, 0), iso(W, 0), iso(W, 0, WALL_H), iso(0, 0, WALL_H)])).fill(C.wallBack);
    g.poly(flat([iso(9.6, 0), iso(15, 0), iso(15, 0, WALL_H), iso(9.6, 0, WALL_H)])).fill(C.accent);
    g.poly(flat([iso(0, 0), iso(0, D), iso(0, D, WALL_H), iso(0, 0, WALL_H)])).fill(C.wallLeft);
    g.poly(flat([iso(-0.35, 0, WALL_H), iso(W, 0, WALL_H), iso(W, -0.35, WALL_H), iso(-0.35, -0.35, WALL_H)])).fill(C.wallCap);
    g.poly(flat([iso(0, -0.35, WALL_H), iso(0, D, WALL_H), iso(-0.35, D, WALL_H), iso(-0.35, -0.35, WALL_H)])).fill(C.wallCap);
    g.poly(flat([iso(W, -0.35, WALL_H), iso(W, 0, WALL_H), iso(W, 0, 0), iso(W, -0.35, 0)])).fill(0xd6d3ce);
    g.poly(flat([iso(-0.35, D, WALL_H), iso(0, D, WALL_H), iso(0, D, 0), iso(-0.35, D, 0)])).fill(0xd6d3ce);

    // jendela dinding kiri
    for (const [y0, y1] of [
      [3.6, 5.6],
      [7.4, 9.4],
    ]) {
      g.poly(flat([iso(0, y0, 40), iso(0, y1, 40), iso(0, y1, 100), iso(0, y0, 100)])).fill(0xa9d3f2).stroke({ width: 3, color: C.frame });
      g.moveTo(...iso(0, (y0 + y1) / 2, 40)).lineTo(...iso(0, (y0 + y1) / 2, 100)).stroke({ width: 2, color: C.frame });
    }
    // lukisan dinding belakang
    g.poly(flat([iso(5.5, 0, 55), iso(7.2, 0, 55), iso(7.2, 0, 100), iso(5.5, 0, 100)])).fill(0xffffff).stroke({ width: 3, color: C.frame });
    g.poly(flat([iso(5.8, 0, 62), iso(6.5, 0, 62), iso(6.5, 0, 92), iso(5.8, 0, 92)])).fill(0xe3a33b);
    g.poly(flat([iso(6.5, 0, 62), iso(6.9, 0, 62), iso(6.9, 0, 80), iso(6.5, 0, 80)])).fill(C.accent);
    // TV ruang meeting
    g.poly(flat([iso(11.4, 0, 50), iso(13.6, 0, 50), iso(13.6, 0, 100), iso(11.4, 0, 100)])).fill(0x1a1f29);
    // kabinet atas pantry
    g.poly(flat([iso(15.4, 0, 70), iso(W, 0, 70), iso(W, 0, 105), iso(15.4, 0, 105)])).fill(0xf4f2ee).stroke({ width: 1.5, color: 0xcfcac2 });
    this.world.addChild(g);

    // furnitur statis (diurutkan kedalaman)
    const f = (sortKey: number, draw: (g: Graphics) => void) => {
      const gg = new Graphics();
      draw(gg);
      this.add(gg, sortKey);
    };
    // rak buku
    f(3.5 + 0.7, (g) => {
      box(g, 3.2, 0.1, 0, 1.8, 0.6, 95, 0x5b6170, 0x4a505d, 0x3f4450);
      for (let z = 20; z < 95; z += 24) {
        g.poly(flat([iso(3.25, 0.7, z), iso(4.95, 0.7, z), iso(4.95, 0.7, z + 4), iso(3.25, 0.7, z + 4)])).fill(C.wood);
        g.poly(flat([iso(3.4, 0.7, z + 4), iso(3.9, 0.7, z + 4), iso(3.9, 0.7, z + 18), iso(3.4, 0.7, z + 18)])).fill(z % 48 ? 0x3e6aa8 : 0xe3a33b);
      }
    });
    // meja & kursi meeting
    f(14 + 2.8, (g) => box(g, 10.6, 1.6, 0, 3.6, 1.4, 26, C.wood, C.woodFront, C.woodSide));
    for (const [x, y] of MEETING) f(x + y + 0.2, (g) => this.chair(g, x, y, C.chairBlue));
    // dinding kaca ruang meeting
    f(15 + 4.6 + 0.5, (g) => {
      g.poly(flat([iso(9.6, 4.6), iso(15, 4.6), iso(15, 4.6, 110), iso(9.6, 4.6, 110)])).fill({ color: C.glass, alpha: 0.22 });
      for (const x of [9.6, 11.4, 13.2, 15]) g.moveTo(...iso(x, 4.6)).lineTo(...iso(x, 4.6, 110)).stroke({ width: 3, color: C.frame });
      g.moveTo(...iso(9.6, 4.6, 110)).lineTo(...iso(15, 4.6, 110)).stroke({ width: 3, color: C.frame });
    });
    f(9.6 + 4.6, (g) => {
      g.poly(flat([iso(9.6, 0), iso(9.6, 4.6), iso(9.6, 4.6, 110), iso(9.6, 0, 110)])).fill({ color: C.glass, alpha: 0.22 });
      for (const y of [0, 2.3, 4.6]) g.moveTo(...iso(9.6, y)).lineTo(...iso(9.6, y, 110)).stroke({ width: 3, color: C.frame });
      g.moveTo(...iso(9.6, 0, 110)).lineTo(...iso(9.6, 4.6, 110)).stroke({ width: 3, color: C.frame });
    });
    // pantry
    f(15.4 + 1.0, (g) => box(g, 15.4, 0.05, 0, 0.9, 0.9, 85, 0x8d939c, 0x7b818a, 0x6c727a));
    f(W + 0.9, (g) => {
      box(g, 16.3, 0.05, 0, W - 16.3, 0.85, 32, 0xf1efea, 0xc49a6c, 0xb58c5f);
    });
    f(17.6 + 3.4, (g) => box(g, 15.6, 2.6, 0, 2.0, 0.8, 32, 0xf4f2ee, 0x3a4150, 0x2c323d));
    for (const x of [15.8, 16.5, 17.2]) f(x + 3.9, (g) => this.stool(g, x, 3.75));
    // lounge
    f(16.8 + 9.2, (g) => box(g, 13.6, 8.6, 0, 3.2, 0.5, 34, C.sofa, C.sofaSide, C.sofaSide));
    f(16.8 + 9.9, (g) => box(g, 13.6, 9.1, 0, 3.2, 0.8, 16, 0x7d9a5c, C.sofaSide, C.sofaSide));
    f(15.6 + 11.2, (g) => box(g, 14.4, 10.4, 0, 1.2, 0.8, 18, C.wood, C.woodFront, C.woodSide));
    f(17.6 + 11.6, (g) => {
      box(g, 16.8, 10.6, 0, 0.8, 0.8, 16, C.chairBlue, 0x34507a, 0x2c4468);
      box(g, 17.4, 10.6, 16, 0.2, 0.8, 18, C.chairBlue, 0x34507a, 0x2c4468);
    });
    // tanaman
    for (const [x, y, big] of [
      [0.5, 0.5, 1],
      [8.6, 0.5, 1],
      [17.3, 6.3, 1],
      [0.5, 12.3, 1],
      [12.2, 12.2, 0],
      [6.0, 12.3, 0],
    ] as const) {
      f(x + y + 0.6, (g) => this.plant(g, x, y, big === 1));
    }
  }

  private chair(g: Graphics, x: number, y: number, color: number) {
    box(g, x - 0.25, y - 0.2, 12, 0.5, 0.45, 5, color, 0x2a3140, 0x232936);
    g.moveTo(...iso(x, y, 0)).lineTo(...iso(x, y, 12)).stroke({ width: 3, color: 0x232936 });
    g.ellipse(...iso(x, y, 0), 10, 4).fill({ color: 0x000000, alpha: 0.12 });
  }

  private stool(g: Graphics, x: number, y: number) {
    g.moveTo(...iso(x, y, 0)).lineTo(...iso(x, y, 24)).stroke({ width: 3, color: 0x232936 });
    g.ellipse(iso(x, y, 24)[0], iso(x, y, 24)[1], 10, 5).fill(0x7d9a5c);
  }

  private plant(g: Graphics, x: number, y: number, big: boolean) {
    const s = big ? 1 : 0.7;
    box(g, x - 0.3 * s, y - 0.3 * s, 0, 0.6 * s, 0.6 * s, 22 * s, 0xf4f2ee, 0xdedbd5, 0xcfcac2);
    const [cx, cy] = iso(x, y, 22 * s);
    const leaves: [number, number, number, number, number][] = [
      [-10, -18, 7, 18, -0.5],
      [10, -18, 7, 18, 0.5],
      [0, -26, 7, 20, 0],
      [-16, -8, 6, 14, -1],
      [16, -8, 6, 14, 1],
    ];
    for (const [dx, dy, rx, ry, rot] of leaves) {
      const leaf = new Graphics().ellipse(0, 0, rx * s, ry * s).fill(dx === 0 ? C.green : C.greenDark);
      leaf.position.set(cx + dx * s, cy + dy * s);
      leaf.rotation = rot;
      g.addChild(leaf);
    }
  }

  /* ---------------- Meja & orang (dinamis) ---------------- */

  private drawDesks(count: number) {
    for (let i = 0; i < count; i++) {
      const [px, py] = DESKS[i]!;
      const dx = px - 1.0;
      const dy = py - 1.45;
      const g = new Graphics();
      // partisi biru di belakang meja
      box(g, dx, dy - 0.12, 0, 2.0, 0.12, 58, C.partition, C.partitionSide, C.partitionSide);
      // kaki & laci
      box(g, dx + 1.4, dy + 0.1, 0, 0.5, 0.8, DESK_H, C.dark, C.darkFront, C.darkSide);
      g.moveTo(...iso(dx + 0.1, dy + 0.9, 0)).lineTo(...iso(dx + 0.1, dy + 0.9, DESK_H)).stroke({ width: 3, color: C.darkSide });
      // permukaan meja
      box(g, dx, dy, DESK_H, 2.0, 1.0, 4, C.wood, C.woodFront, C.woodSide);
      // monitor & keyboard
      box(g, dx + 0.7, dy + 0.15, DESK_H + 4, 0.6, 0.08, 24, C.dark, 0x1f2937, C.darkSide);
      g.poly(flat([iso(dx + 0.7, dy + 0.6, DESK_H + 4.5), iso(dx + 1.3, dy + 0.6, DESK_H + 4.5), iso(dx + 1.3, dy + 0.78, DESK_H + 4.5), iso(dx + 0.7, dy + 0.78, DESK_H + 4.5)])).fill(0x9aa3b2);
      // tanaman kecil di meja
      if (i % 3 === 1) {
        const [cx, cy] = iso(dx + 1.75, dy + 0.3, DESK_H + 4);
        g.rect(cx - 4, cy - 8, 8, 8).fill(0xf4f2ee);
        g.circle(cx, cy - 12, 6).fill(C.green);
      }
      const holder = new Container();
      holder.addChild(g);
      holder.zIndex = (dx + 2 + dy + 1) * 10;
      this.objects.addChild(holder);
      (holder as Container & { deskIndex?: number }).deskIndex = i;
    }
  }

  private seatFor(agent: Agent): Pt {
    if (agent.status === "meeting") {
      const meetingIdx = [...this.people.values()].filter((p) => p.agent.status === "meeting" && p.agent.seat < agent.seat).length;
      return MEETING[meetingIdx % MEETING.length]!;
    }
    return DESKS[Math.min(agent.seat, DESKS.length - 1)]!;
  }

  private createPerson(agent: Agent): Person {
    const root = new Container();
    root.eventMode = "static";
    root.cursor = "pointer";
    root.on("pointertap", (e) => {
      e.stopPropagation();
      this.cb.onSelect(agent.id);
    });

    const ring = new Graphics().ellipse(0, 4, 26, 12).stroke({ width: 3, color: 0x1e4fd8 }).ellipse(0, 4, 26, 12).fill({ color: 0x1e4fd8, alpha: 0.15 });
    ring.visible = false;
    root.addChild(ring);

    const chair = new Graphics();
    chair.moveTo(0, 0).lineTo(0, -12).stroke({ width: 3, color: 0x232936 });
    chair.ellipse(0, 0, 10, 4).fill({ color: 0x000000, alpha: 0.15 });
    root.addChild(chair);

    const body = new Container();
    const look = agent.look;
    const b = new Graphics();
    // rambut panjang di belakang
    if (look.hairStyle === "long") b.roundRect(-9, -46, 18, 26, 8).fill(look.hair);
    if (look.hairStyle === "hijab") b.roundRect(-12, -50, 24, 30, 10).fill(look.shirt === "#EDE3D1" ? 0xb97c7c : 0x8a6b8f);
    // badan
    b.roundRect(-11, -30, 22, 24, 9).fill(look.shirt);
    b.roundRect(2, -30, 9, 24, 6).fill({ color: 0x000000, alpha: 0.12 });
    // lengan ke arah meja (kanan atas)
    b.roundRect(6, -26, 14, 6, 3).fill(look.shirt);
    b.circle(21, -24, 3).fill(look.skin);
    b.roundRect(-14, -24, 8, 6, 3).fill(look.shirt);
    // kepala (dilihat dari belakang-samping)
    b.circle(1, -38, 8).fill(look.skin);
    if (look.hairStyle === "hijab") b.circle(0, -39, 9).fill(look.shirt === "#EDE3D1" ? 0xb97c7c : 0x8a6b8f);
    else {
      b.circle(-0.5, -39.5, 8.4).fill(look.hair);
      b.circle(4, -37, 3).fill(look.skin);
      if (look.hairStyle === "bun") b.circle(-2, -48, 4).fill(look.hair);
      if (look.hairStyle === "curly") for (const [hx, hy] of [[-6, -43], [0, -46], [6, -43]]) b.circle(hx!, hy!, 4).fill(look.hair);
    }
    // sandaran kursi rendah (lebih dekat ke kamera) agar baju tetap terlihat
    b.roundRect(-10, -14, 20, 12, 4).fill(0x2f3440);
    body.addChild(b);
    body.scale.set(1.2);
    root.addChild(body);

    const bubble = new Container();
    const bubbleBg = new Graphics();
    const label = new Text({ text: agent.name, style: { fontFamily: "Plus Jakarta Sans, system-ui, sans-serif", fontSize: 11, fontWeight: "800", fill: 0x0e1726 } });
    const status = new Text({ text: "", style: { fontFamily: "Plus Jakarta Sans, system-ui, sans-serif", fontSize: 10, fontWeight: "500", fill: 0x3b4656 } });
    label.position.set(18, 5);
    status.position.set(8, 20);
    bubble.addChild(bubbleBg, label, status);
    bubble.eventMode = "static";
    bubble.cursor = "pointer";
    bubble.on("pointertap", (e) => {
      e.stopPropagation();
      this.cb.onSelect(agent.id);
    });
    this.overlay.addChild(bubble);

    const start = this.seatFor(agent);
    const p: Person = { agent, root, body, bubble, bubbleBg, label, status, ring, monitorGlow: null, pos: [...start], target: start };
    this.placeRoot(p);
    this.objects.addChild(root);
    return p;
  }

  private placeRoot(p: Person) {
    const [sx, sy] = iso(p.pos[0], p.pos[1]);
    p.root.position.set(sx, sy);
    p.root.zIndex = (p.pos[0] + p.pos[1]) * 10 + 5;
  }

  private drawBubble(p: Person, statusText: string, dot: number, selected: boolean) {
    p.label.text = `${p.agent.name} · ${p.agent.role}`;
    p.status.text = statusText;
    p.label.style.fill = selected ? 0xffffff : 0x0e1726;
    p.status.style.fill = selected ? 0xdbe6ff : 0x3b4656;
    const w = Math.max(p.label.width + 26, p.status.width + 16);
    const h = 36;
    p.bubbleBg.clear();
    p.bubbleBg.roundRect(0, 0, w, h, 9).fill(selected ? 0x1e4fd8 : 0xffffff).stroke({ width: 1, color: selected ? 0xffffff : 0xd5dce6 });
    p.bubbleBg.poly([w / 2 - 5, h, w / 2 + 5, h, w / 2, h + 6]).fill(selected ? 0x1e4fd8 : 0xffffff);
    p.bubbleBg.circle(11, 11, 4).fill(dot);
    p.bubble.pivot.x = w / 2;
  }

  /* ---------------- API publik ---------------- */

  async update(agents: Agent[], tasks: Task[], selectedId: string | null) {
    await this.ready;
    if (this.destroyed) return;
    this.selectedId = selectedId;
    const deskCount = agents.length;
    if (deskCount !== this.deskCount) {
      for (const c of [...this.objects.children]) {
        if ((c as Container & { deskIndex?: number }).deskIndex !== undefined) c.destroy({ children: true });
      }
      this.drawDesks(deskCount);
      this.deskCount = deskCount;
    }
    const seen = new Set<string>();
    for (const agent of agents) {
      seen.add(agent.id);
      let p = this.people.get(agent.id);
      if (!p) {
        p = this.createPerson(agent);
        this.people.set(agent.id, p);
      }
      p.agent = agent;
    }
    for (const [id, p] of this.people) {
      if (!seen.has(id)) {
        p.root.destroy({ children: true });
        p.bubble.destroy({ children: true });
        this.people.delete(id);
      }
    }
    for (const p of this.people.values()) {
      p.target = this.seatFor(p.agent);
      const task = tasks.find((t) => t.id === p.agent.currentTaskId);
      const reviewing = tasks.find((t) => t.reviewerId === p.agent.id && t.status === "in_review");
      const short = (s: string) => (s.length > 24 ? `${s.slice(0, 23)}…` : s);
      const [text, dot] =
        p.agent.status === "working" && task
          ? [`${task.code} · ${short(task.title)} · ${task.progress}%`, 0x16a34a]
          : p.agent.status === "reviewing" && reviewing
            ? [`Mereview ${reviewing.code}`, 0xd97706]
            : p.agent.status === "meeting"
              ? ["Koordinasi tim", 0x1e4fd8]
              : ["Menunggu task", 0x8a94a3];
      const selected = p.agent.id === selectedId;
      p.ring.visible = selected;
      this.drawBubble(p, text, dot, selected);
    }
  }

  setZoom(factor: number) {
    this.zoom = Math.min(2.2, Math.max(0.5, this.zoom * factor));
    this.fit();
  }

  private fit() {
    const sw = this.app.renderer?.width / (this.app.renderer?.resolution || 1);
    const sh = this.app.renderer?.height / (this.app.renderer?.resolution || 1);
    if (!sw || !sh) return;
    const worldW = (W + D) * (TW / 2) + 60;
    const worldH = (W + D) * (TH / 2) + WALL_H + 80;
    const s = Math.min(sw / worldW, sh / worldH) * this.zoom;
    this.world.scale.set(s);
    // pusatkan: titik tengah lantai
    const [cx, cy] = iso(W / 2, D / 2, 30);
    this.world.position.set(sw / 2 - cx * s + this.pan[0], sh / 2 - cy * s + this.pan[1]);
  }

  private pan: Pt = [0, 0];
  private enablePan() {
    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;
    let drag: { x: number; y: number; px: number; py: number } | null = null;
    stage.on("pointerdown", (e) => (drag = { x: e.global.x, y: e.global.y, px: this.pan[0], py: this.pan[1] }));
    stage.on("pointerup", () => (drag = null));
    stage.on("pointerupoutside", () => (drag = null));
    stage.on("pointermove", (e) => {
      if (!drag) return;
      this.pan = [drag.px + e.global.x - drag.x, drag.py + e.global.y - drag.y];
      this.fit();
    });
  }

  private animate(time: number) {
    for (const p of this.people.values()) {
      // berjalan menuju kursi target (mis. PM ke ruang meeting)
      const dx = p.target[0] - p.pos[0];
      const dy = p.target[1] - p.pos[1];
      const dist = Math.hypot(dx, dy);
      if (dist > 0.02) {
        const step = Math.min(dist, 0.06);
        p.pos = [p.pos[0] + (dx / dist) * step, p.pos[1] + (dy / dist) * step];
        p.body.y = Math.sin(time / 90) * 2;
      } else if (p.agent.status === "working") {
        p.body.y = Math.sin(time / 110 + p.agent.seat) * 1.2;
      } else {
        p.body.y = Math.sin(time / 700 + p.agent.seat) * 0.6;
      }
      this.placeRoot(p);
      p.bubble.position.set(p.root.x, p.root.y - 64 + Math.sin(time / 600 + p.agent.seat) * 2);
      p.bubble.zIndex = p.agent.id === this.selectedId ? 100000 : p.root.zIndex;
    }
  }

  destroy() {
    this.destroyed = true;
    try {
      this.app.destroy(true, { children: true });
    } catch {
      /* belum siap */
    }
  }
}
