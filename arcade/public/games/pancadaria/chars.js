'use strict';
// =====================================================================
//  PANCADARIA — personagens, poses e desenho dos lutadores
//  Os lutadores são desenhados com um "esqueleto" (ângulos de cada membro)
//  e as poses são interpoladas para animar.
// =====================================================================
(() => {
const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;

// --------------------------------------------------------------------
//  POSES (graus). Ângulo 0 = membro apontando para baixo, 90 = para frente,
//  180 = para cima, -90 = para trás. lean = inclinação do tronco.
// --------------------------------------------------------------------
const STANCE_L = { fl: [22, 0], bl: [-24, -8] };
const CROUCH_L = { fl: [80, -5], bl: [60, -50] };
const POSES = {
  idle:     { lean: 6, head: 0, fa: [35, 125], ba: [15, 140], ...STANCE_L },
  crouch:   { lean: 18, head: 0, fa: [45, 140], ba: [25, 150], ...CROUCH_L },
  jump:     { lean: 10, head: 0, fa: [70, 150], ba: [40, 160], fl: [100, 10], bl: [55, -40] },
  punch:    { lean: 14, head: 0, fa: [88, 88], ba: [20, 130], fl: [30, 5], bl: [-32, -14] },
  kick:     { lean: -18, head: 0, fa: [50, 140], ba: [-10, 150], fl: [98, 96], bl: [-4, -4] },
  cpunch:   { lean: 18, head: 0, fa: [88, 88], ba: [25, 150], ...CROUCH_L },
  sweep:    { lean: 35, head: 0, fa: [60, 120], ba: [30, 150], fl: [88, 90], bl: [85, -60] },
  jpunch:   { lean: 20, head: 0, fa: [60, 55], ba: [30, 150], fl: [90, 20], bl: [60, -30], air: true },
  jkick:    { lean: -10, head: 0, fa: [60, 150], ba: [20, 160], fl: [65, 62], bl: [90, -20], air: true },
  block:    { lean: -8, head: -5, fa: [55, 165], ba: [45, 170], fl: [20, 0], bl: [-25, -10] },
  cblock:   { lean: 10, head: -5, fa: [55, 165], ba: [45, 170], ...CROUCH_L },
  hit:      { lean: -28, head: -20, fa: [-30, 0], ba: [-50, -20], fl: [15, 0], bl: [-25, -10] },
  hitair:   { lean: -20, head: -20, fa: [-80, -60], ba: [-110, -90], fl: [40, 10], bl: [10, -10], rot: -35, air: true },
  knock:    { lean: 0, head: 0, fa: [8, 8], ba: [-8, -8], fl: [8, 0], bl: [-6, 0], rot: -90 },
  getup:    { lean: 30, head: 0, fa: [60, 30], ba: [40, 10], ...CROUCH_L },
  win:      { lean: 0, head: -8, fa: [175, 180], ba: [-20, 10], fl: [12, 0], bl: [-12, 0] },
  fireStart:{ lean: -5, head: 0, fa: [-40, 40], ba: [-50, 30], fl: [30, 5], bl: [-32, -14] },
  fire:     { lean: 18, head: 0, fa: [86, 88], ba: [82, 86], fl: [35, 8], bl: [-35, -15] },
  upper:    { lean: -6, head: -10, fa: [172, 178], ba: [20, 100], fl: [60, -10], bl: [0, 0], air: true },
  spin:     { lean: 0, head: 0, fa: [60, 30], ba: [-60, -30], fl: [92, 92], bl: [20, -30], lift: 18 },
  lightning:{ lean: -12, head: 0, fa: [-20, 30], ba: [-40, 20], fl: [95, 95], bl: [-3, -3] },
  bird:     { lean: 0, head: 0, fa: [15, 5], ba: [-15, -5], fl: [95, 95], bl: [-95, -95], rot: 180, lift: 70 },
  risekick: { lean: -10, head: 0, fa: [30, 90], ba: [-30, 60], fl: [150, 150], bl: [30, -20], air: true },
  flash:    { lean: -10, head: 0, fa: [-40, 0], ba: [-60, -10], fl: [160, 160], bl: [20, -20], air: true },
  lariat:   { lean: 0, head: 0, fa: [90, 90], ba: [-90, -90], fl: [15, 0], bl: [-15, 0] },
  grab:     { lean: 15, head: 0, fa: [80, 40], ba: [75, 30], fl: [30, 5], bl: [-32, -14] },
  toss:     { lean: -20, head: -10, fa: [160, 170], ba: [150, 170], fl: [25, 5], bl: [-30, -10] },
  tackle:   { lean: 40, head: 10, fa: [110, 60], ba: [30, 90], fl: [50, -10], bl: [-40, -50] },
  knee:     { lean: -15, head: 0, fa: [30, 120], ba: [-20, 130], fl: [110, -20], bl: [-5, -5] },
  electric: { lean: 30, head: 10, fa: [70, 10], ba: [50, 0], fl: [70, -30], bl: [50, -50] },
  ball:     { lean: 70, head: 30, fa: [130, 170], ba: [120, 170], fl: [140, 10], bl: [130, 0], lift: 14 },
  yogaFire: { lean: 10, head: 15, fa: [85, 85], ba: [85, 85], fl: [30, 5], bl: [-32, -14] },
  yogaFlame:{ lean: 25, head: 25, fa: [100, 110], ba: [95, 105], fl: [35, 8], bl: [-35, -15] },
};

function lerpPose(a, b, t) {
  const o = {};
  for (const k of ['lean', 'head', 'rot', 'lift', 'armK', 'legK']) {
    const av = a[k] ?? (k === 'armK' || k === 'legK' ? 1 : 0);
    const bv = b[k] ?? (k === 'armK' || k === 'legK' ? 1 : 0);
    o[k] = lerp(av, bv, t);
  }
  for (const k of ['fa', 'ba', 'fl', 'bl']) o[k] = [lerp(a[k][0], b[k][0], t), lerp(a[k][1], b[k][1], t)];
  o.air = t < 0.5 ? a.air : b.air;
  return o;
}
const withPose = (name, extra) => ({ ...POSES[name], ...extra });

// --------------------------------------------------------------------
//  GOLPES
// --------------------------------------------------------------------
function mv(o) {
  return {
    startup: 5, active: 3, recovery: 10, dmg: 50, chip: 0, hs: 15, bs: 11, push: 4,
    level: 'mid', hits: 1, rehit: 999, ...o,
  };
}

// Golpes normais, ajustados pelo tamanho/alcance de cada lutador
function normals(c) {
  const b = c.body, s = b.scale, ra = c.reach.arm, rl = c.reach.leg, slow = c.reach.slow || 0;
  const arm = (b.uarm + b.farm) * s * ra, leg = (b.thigh + b.shin) * s * rl;
  return {
    sP: mv({ name: 'Soco', pose: 'punch', armK: ra, startup: 4 + slow, active: 3, recovery: 8, dmg: 45, hs: 14, bs: 10, push: 3.5,
      hb: { x: 6 * s, y: 60 * s, w: arm + 4, h: 18 * s } }),
    sK: mv({ name: 'Chute', pose: 'kick', legK: rl, startup: 7 + slow, active: 4, recovery: 14, dmg: 75, hs: 17, bs: 13, push: 5, heavy: true,
      hb: { x: 6 * s, y: 40 * s, w: leg + 8, h: 20 * s } }),
    cP: mv({ name: 'Soco baixo', pose: 'cpunch', armK: ra, startup: 4 + slow, active: 3, recovery: 8, dmg: 40, hs: 13, bs: 9, push: 3.5,
      hb: { x: 6 * s, y: 40 * s, w: arm + 4, h: 16 * s } }),
    cK: mv({ name: 'Rasteira', pose: 'sweep', legK: rl, startup: 8 + slow, active: 4, recovery: 20, dmg: 70, bs: 12, push: 4, level: 'low', kd: true,
      launch: { vx: 2, vy: -4 }, heavy: true, hb: { x: 8 * s, y: 0, w: leg + 10, h: 18 * s } }),
    jP: mv({ name: 'Soco aéreo', pose: 'jpunch', armK: ra, air: true, startup: 4, active: 10, recovery: 4, dmg: 60, hs: 16, bs: 12, level: 'high',
      hb: { x: 0, y: 18 * s, w: arm * 0.95, h: 34 * s } }),
    jK: mv({ name: 'Voadora', pose: 'jkick', legK: rl, air: true, startup: 6, active: 12, recovery: 4, dmg: 80, hs: 18, bs: 13, level: 'high', heavy: true,
      hb: { x: 0, y: -4 * s, w: leg + 4, h: 34 * s } }),
    throw: mv({ name: 'Arremesso', pose: 'grab', startup: 3, active: 1, recovery: 18, grab: { range: 52 * s + 6, dmg: 110, kind: 'throw' } }),
  };
}

// --------------------------------------------------------------------
//  LUTADORES
//  Comandos no celular:  ESPECIAL = esp1 · ↑+ESPECIAL = esp2 · ↓+ESPECIAL = esp3
//  Comandos clássicos:  ↓↘→+SOCO = esp1 · →↓↘+SOCO = esp2 · ↓↙←+CHUTE = esp3
// --------------------------------------------------------------------
const BODY = { scale: 1, bw: 1, thigh: 22, shin: 22, torso: 34, uarm: 17, farm: 17, headR: 10, torsoW: 20, armW: 9, legW: 11 };

const CHARS = [
  {
    id: 'kenji', name: 'KENJI', title: 'Karateca errante', color: '#d62828',
    hp: 1000, walk: 2.6, back: 2.1, jumpV: 12.5, jumpH: 3.6, grav: 0.62,
    body: { ...BODY },
    reach: { arm: 1, leg: 1 },
    look: { skin: '#f1c27d', torso: '#f4f4f4', arm: null, thigh: '#f4f4f4', shin: '#f4f4f4', boot: null, belt: '#1d1d1d', hair: '#2e1d12', hairStyle: 'headband', accent: '#d62828' },
    ai: { proj: true, antiAir: 'sp2', approach: 'sp3' },
    moves: {
      sp1: mv({ name: 'Onda Ki', pose: 'fire', startPose: 'fireStart', startup: 12, active: 2, recovery: 26, projSlot: true,
        proj: { at: 12, speed: 5, dmg: 90, chip: 15, r: 12, kind: 'ki', y: 62, hs: 18, bs: 14 } }),
      sp2: mv({ name: 'Punho do Dragão', pose: 'upper', startup: 3, active: 12, recovery: 0, dmg: 140, hs: 20, kd: true, heavy: true,
        launch: { vx: 3, vy: -9 }, invuln: [0, 8], vx: 2.6, vy: -12.5, untilLand: true, landLag: 16,
        hb: { x: 0, y: 55, w: 40, h: 60 } }),
      sp3: mv({ name: 'Chute Furacão', pose: 'spin', spin: 5, startup: 8, active: 30, recovery: 10, dmg: 45, hits: 3, rehit: 9, kdLast: true,
        hs: 16, bs: 10, vx: 4.2, keepVx: true, launch: { vx: 4, vy: -6 }, hb: { x: -10, y: 50, w: 60, h: 26 } }),
      super: mv({ name: 'Onda Ki Suprema', pose: 'fire', startPose: 'fireStart', startup: 10, active: 2, recovery: 30, invuln: [0, 12], projSlot: true,
        proj: { at: 10, speed: 5.5, dmg: 50, chip: 10, r: 26, hits: 5, rehit: 4, kind: 'superki', y: 60, hs: 14, bs: 10, kdLast: true } }),
    },
  },
  {
    id: 'meilin', name: 'MEI LIN', title: 'Mestra do kung fu', color: '#1f5fd1',
    hp: 920, walk: 3.0, back: 2.5, jumpV: 13.5, jumpH: 4.2, grav: 0.66,
    body: { ...BODY, scale: 0.93, torsoW: 17, armW: 8, legW: 10, headR: 10 },
    reach: { arm: 0.95, leg: 1.15 },
    look: { skin: '#f3cfa4', torso: '#1f5fd1', arm: null, thigh: '#1f5fd1', shin: '#c68642', boot: '#f4f4f4', bootFrom: 0.45, belt: '#e5b931', hair: '#1a1a1a', hairStyle: 'buns', accent: '#ffffff', bracelets: '#555' },
    ai: { proj: true, antiAir: 'sp2', approach: 'sp3' },
    moves: {
      sp1: mv({ name: 'Esfera Kiko', pose: 'fire', startPose: 'fireStart', startup: 14, active: 2, recovery: 22, projSlot: true,
        proj: { at: 14, speed: 3.6, dmg: 75, chip: 12, r: 11, kind: 'kiko', y: 56, life: 70, hs: 17, bs: 13 } }),
      sp2: mv({ name: 'Chute Celestial', pose: 'risekick', spin: 4, startup: 4, active: 16, recovery: 0, dmg: 45, hits: 3, rehit: 5, kdLast: true,
        hs: 16, invuln: [0, 6], vx: 2, vy: -11.5, untilLand: true, landLag: 14, launch: { vx: 3, vy: -8 }, hb: { x: -10, y: 50, w: 50, h: 70 } }),
      sp3: mv({ name: 'Giro da Garça', pose: 'bird', spin: 5, startup: 10, active: 28, recovery: 12, dmg: 40, hits: 4, rehit: 7, kdLast: true,
        hs: 15, bs: 9, vx: 4, keepVx: true, launch: { vx: 4, vy: -6 }, hb: { x: -45, y: 58, w: 90, h: 26 } }),
      super: mv({ name: 'Mil Chutes', pose: 'lightning', shake: 30, startup: 6, active: 48, recovery: 18, dmg: 18, hits: 10, rehit: 4, kdLast: true,
        hs: 12, bs: 6, push: 1, invuln: [0, 8], launch: { vx: 5, vy: -7 }, hb: { x: 6, y: 40, w: 70, h: 40 } }),
    },
  },
  {
    id: 'rocha', name: 'ROCHA', title: 'Sargento das forças especiais', color: '#556b2f',
    hp: 1000, walk: 2.4, back: 2.2, jumpV: 12.3, jumpH: 3.4, grav: 0.62,
    body: { ...BODY, scale: 1.05, torsoW: 22, armW: 10, legW: 12 },
    reach: { arm: 1, leg: 1.05 },
    look: { skin: '#e0ac69', torso: '#4b5d2a', arm: null, thigh: '#6b7a3a', shin: '#6b7a3a', boot: '#1d1d1d', bootFrom: 0.55, belt: '#2d2d2d', hair: '#e8c25a', hairStyle: 'flattop', accent: '#c0c0c0' },
    ai: { proj: true, antiAir: 'sp2', approach: 'sp3' },
    moves: {
      sp1: mv({ name: 'Lâmina Sônica', pose: 'fire', startPose: 'fireStart', startup: 10, active: 2, recovery: 20, projSlot: true,
        proj: { at: 10, speed: 7, dmg: 70, chip: 10, r: 13, kind: 'sonic', y: 62, hs: 16, bs: 12 } }),
      sp2: mv({ name: 'Chute Meia-Lua', pose: 'flash', flip: 1, startup: 3, active: 14, recovery: 0, dmg: 130, hs: 20, kd: true, heavy: true,
        launch: { vx: 3, vy: -9 }, invuln: [0, 9], vx: 1.6, vy: -11.5, untilLand: true, landLag: 16, hb: { x: -5, y: 40, w: 55, h: 80 } }),
      sp3: mv({ name: 'Joelhada', pose: 'knee', startup: 6, active: 12, recovery: 16, dmg: 85, hs: 18, bs: 12, vx: 6.5, keepVx: true,
        hb: { x: 4, y: 40, w: 34, h: 30 } }),
      super: mv({ name: 'Meia-Lua Dupla', pose: 'flash', flip: 2, startup: 4, active: 26, recovery: 0, dmg: 50, hits: 4, rehit: 6, kdLast: true, heavy: true,
        hs: 16, invuln: [0, 14], vx: 1.8, vy: -13.5, untilLand: true, landLag: 16, launch: { vx: 4, vy: -9 }, hb: { x: -10, y: 40, w: 60, h: 90 } }),
    },
  },
  {
    id: 'igor', name: 'IGOR', title: 'O urso da luta livre', color: '#c62828',
    hp: 1150, walk: 1.9, back: 1.7, jumpV: 11.5, jumpH: 3.0, grav: 0.62,
    body: { ...BODY, scale: 1.22, bw: 1.25, torsoW: 30, armW: 13, legW: 15, headR: 10 },
    reach: { arm: 1, leg: 0.95, slow: 1 },
    look: { skin: '#f3c7a5', torso: null, arm: null, thigh: null, shin: null, boot: '#c62828', bootFrom: 0.35, belt: '#c62828', beltW: 1.6, hair: '#6d3b1f', hairStyle: 'mohawk', accent: '#ffd400', chestHair: true, wrist: '#ffd400' },
    ai: { grab: 'sp1', antiAir: 'sp2', approach: 'sp3' },
    moves: {
      sp1: mv({ name: 'Pilão Giratório', pose: 'grab', startup: 4, active: 1, recovery: 32, grab: { range: 70, dmg: 210, kind: 'pile' } }),
      sp2: mv({ name: 'Laço Duplo', pose: 'lariat', spin: 6, startup: 6, active: 34, recovery: 12, dmg: 40, hits: 4, rehit: 8, kdLast: true,
        hs: 16, bs: 10, steer: 1.6, projInvuln: [0, 40], launch: { vx: 4, vy: -7 }, hb: { x: -60, y: 55, w: 120, h: 40 } }),
      sp3: mv({ name: 'Investida do Urso', pose: 'tackle', startup: 8, active: 16, recovery: 18, dmg: 100, hs: 20, bs: 12, vx: 7, keepVx: true,
        armor: true, kd: true, launch: { vx: 5, vy: -6 }, heavy: true, hb: { x: 6, y: 30, w: 40, h: 60 } }),
      super: mv({ name: 'Pilão Final', pose: 'grab', startup: 2, active: 1, recovery: 34, invuln: [0, 4], grab: { range: 90, dmg: 380, kind: 'pile', big: true } }),
    },
  },
  {
    id: 'trovao', name: 'TROVÃO', title: 'A fera da Amazônia', color: '#43a047',
    hp: 1000, walk: 2.6, back: 2.3, jumpV: 12.8, jumpH: 3.8, grav: 0.64,
    body: { ...BODY, scale: 1.08, bw: 1.1, torsoW: 25, armW: 12, legW: 13, headR: 11 },
    reach: { arm: 1.05, leg: 1 },
    look: { skin: '#4caf50', torso: null, arm: null, thigh: '#7b4a2a', shin: null, boot: null, belt: '#a0522d', hair: '#ff8f00', hairStyle: 'wild', accent: '#ff8f00' },
    ai: { proj: false, antiAir: 'sp2', approach: 'sp1', close: 'sp3' },
    moves: {
      sp1: mv({ name: 'Bola de Canhão', pose: 'ball', spinRot: 24, startup: 10, active: 30, recovery: 4, dmg: 110, hs: 20, bs: 14, vx: 8.5, keepVx: true,
        bounce: true, kd: true, launch: { vx: 4, vy: -6 }, heavy: true, hb: { x: -18, y: 6, w: 40, h: 40 } }),
      sp2: mv({ name: 'Salto Selvagem', pose: 'ball', spinRot: 24, startup: 4, active: 22, recovery: 0, dmg: 100, hs: 20, kd: true, invuln: [0, 6],
        vx: 3.4, vy: -12, untilLand: true, landLag: 14, launch: { vx: 3, vy: -8 }, hb: { x: -20, y: 20, w: 44, h: 50 } }),
      sp3: mv({ name: 'Choque Elétrico', pose: 'electric', shake: 2, electric: true, startup: 6, active: 42, recovery: 12, dmg: 35, chip: 6, hits: 5, rehit: 8,
        hs: 14, bs: 10, push: 3, shock: true, hb: { x: -42, y: 0, w: 84, h: 80 } }),
      super: mv({ name: 'Tempestade Tropical', pose: 'electric', shake: 3, electric: true, big: true, startup: 6, active: 60, recovery: 16, dmg: 26, chip: 5, hits: 10, rehit: 6,
        hs: 12, bs: 8, push: 2, shock: true, invuln: [0, 10], kdLast: true, launch: { vx: 5, vy: -8 }, hb: { x: -75, y: 0, w: 150, h: 120 } }),
    },
  },
  {
    id: 'asha', name: 'ASHA', title: 'Mestra da ioga', color: '#ef6c00',
    hp: 900, walk: 2.0, back: 1.9, jumpV: 11, jumpH: 3.0, grav: 0.45,
    body: { ...BODY, scale: 1.05, torsoW: 16, armW: 7, legW: 9, uarm: 21, farm: 21, thigh: 25, shin: 25, headR: 10 },
    reach: { arm: 1.8, leg: 1.6, slow: 2 },
    look: { skin: '#8d5524', torso: null, arm: null, thigh: '#ef6c00', shin: '#ef6c00', boot: null, belt: '#ffd400', hair: null, hairStyle: 'bald', accent: '#c62828', necklace: '#f5f5f5', bracelets: '#ffd400' },
    ai: { proj: true, antiAir: 'sp2', approach: 'sp3', zoner: true },
    moves: {
      sp1: mv({ name: 'Sopro de Fogo', pose: 'yogaFire', startup: 14, active: 2, recovery: 24, projSlot: true,
        proj: { at: 14, speed: 3.4, dmg: 80, chip: 14, r: 13, kind: 'fire', y: 66, hs: 18, bs: 14 } }),
      sp2: mv({ name: 'Chama Ioga', pose: 'yogaFlame', flame: true, startup: 14, active: 24, recovery: 18, dmg: 40, chip: 6, hits: 3, rehit: 8, kdLast: true,
        hs: 16, bs: 10, launch: { vx: 4, vy: -7 }, hb: { x: 20, y: 40, w: 80, h: 56 } }),
      sp3: mv({ name: 'Teleporte', pose: 'crouch', teleport: true, startup: 12, active: 1, recovery: 22, dmg: 0, invuln: [0, 26] }),
      super: mv({ name: 'Inferno Ioga', pose: 'yogaFlame', flame: true, big: true, startup: 10, active: 40, recovery: 22, dmg: 26, chip: 5, hits: 8, rehit: 5, kdLast: true,
        hs: 14, bs: 8, invuln: [0, 12], launch: { vx: 5, vy: -8 }, hb: { x: 20, y: 30, w: 230, h: 60 } }),
    },
  },
];

for (const c of CHARS) {
  Object.assign(c.moves, normals(c));
  const s = c.body.scale;
  // altura das caixas e projéteis acompanham a escala do lutador
  for (const m of [c.moves.sp1, c.moves.sp2, c.moves.sp3, c.moves.super]) {
    if (m.hb) m.hb = { x: m.hb.x * s, y: m.hb.y * s, w: m.hb.w * s, h: m.hb.h * s };
    if (m.proj) m.proj.y *= s;
  }
  c.hipH = (c.body.thigh + c.body.shin) * s * 0.93;
  c.height = 94 * s;
  c.width = 34 * s * c.body.bw;
}

// --------------------------------------------------------------------
//  DESENHO
// --------------------------------------------------------------------
function points(c, pose, f) {
  const b = c.body, s = b.scale;
  const dir = (a, len) => [Math.sin(a * DEG) * len * f, Math.cos(a * DEG) * len];
  const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
  const hip = [0, 0];
  const tl = b.torso * s, lean = pose.lean || 0;
  const neck = [Math.sin(lean * DEG) * tl * f, -Math.cos(lean * DEG) * tl];
  const hl = (b.headR + 4) * s, ha = lean + (pose.head || 0);
  const head = [neck[0] + Math.sin(ha * DEG) * hl * f, neck[1] - Math.cos(ha * DEG) * hl];
  const sh = [lerp(neck[0], 0, 0.1), lerp(neck[1], 0, 0.1)];
  const ak = pose.armK || 1, lk = pose.legK || 1;
  const fe = add(sh, dir(pose.fa[0], b.uarm * s * ak)), fh = add(fe, dir(pose.fa[1], b.farm * s * ak));
  const be = add(sh, dir(pose.ba[0], b.uarm * s)), bh = add(be, dir(pose.ba[1], b.farm * s));
  const hf = [2 * s * f, 0], hb = [-2 * s * f, 0];
  const fk = add(hf, dir(pose.fl[0], b.thigh * s * lk)), ff = add(fk, dir(pose.fl[1], b.shin * s * lk));
  const bk = add(hb, dir(pose.bl[0], b.thigh * s)), bf = add(bk, dir(pose.bl[1], b.shin * s));
  const P = { hip, neck, head, sh, fe, fh, be, bh, hf, hb, fk, ff, bk, bf };
  if (pose.rot) {
    const a = pose.rot * DEG * f, ca = Math.cos(a), sa = Math.sin(a);
    const cx = neck[0] * 0.5, cy = neck[1] * 0.5;
    for (const k in P) {
      const x = P[k][0] - cx, y = P[k][1] - cy;
      P[k] = [cx + x * ca - y * sa, cy + x * sa + y * ca];
    }
  }
  return P;
}

function seg(ctx, a, b, w, color) {
  ctx.strokeStyle = '#141018';
  ctx.lineWidth = w + 3;
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
}
function dot(ctx, p, r, color) {
  ctx.fillStyle = '#141018';
  ctx.beginPath(); ctx.arc(p[0], p[1], r + 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
}
const mix = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];

function drawLeg(ctx, c, f, hipP, knee, foot) {
  const L = c.look, b = c.body, s = b.scale, w = b.legW * s;
  seg(ctx, hipP, knee, w * 1.08, L.thigh || L.skin);
  const shin = L.shin || L.skin;
  if (L.boot) {
    const k = L.bootFrom ?? 0.5;
    const m = mix(knee, foot, k);
    seg(ctx, knee, m, w * 0.95, shin);
    seg(ctx, m, foot, w * 1.02, L.boot);
  } else seg(ctx, knee, foot, w * 0.95, shin);
  // pé (aponta para o lado em que o lutador olha)
  seg(ctx, foot, [foot[0] + f * 6 * s, foot[1] + 0.5], w * 0.75, L.boot || L.skin);
}

function drawArm(ctx, c, sh, elbow, hand) {
  const L = c.look, b = c.body, s = b.scale, w = b.armW * s;
  seg(ctx, sh, elbow, w * 1.05, L.arm || L.skin);
  seg(ctx, elbow, hand, w * 0.95, L.skin);
  if (L.bracelets) seg(ctx, mix(elbow, hand, 0.62), mix(elbow, hand, 0.82), w * 1.15, L.bracelets);
  if (L.wrist) seg(ctx, mix(elbow, hand, 0.7), mix(elbow, hand, 0.88), w * 1.15, L.wrist);
  dot(ctx, hand, w * 0.72, L.glove || L.skin);
}

function drawHead(ctx, c, P, f, t) {
  const L = c.look, s = c.body.scale, r = c.body.headR * s;
  const h = P.head;
  // cabelo atrás
  if (L.hairStyle === 'wild') {
    ctx.fillStyle = '#141018';
    spikes(ctx, h[0] - f * r * 0.3, h[1] - r * 0.2, r * 1.75, 9, t);
    ctx.fillStyle = L.hair;
    spikes(ctx, h[0] - f * r * 0.3, h[1] - r * 0.2, r * 1.55, 9, t);
  }
  if (L.hairStyle === 'buns') {
    dot(ctx, [h[0] - f * r * 0.7, h[1] - r * 0.75], r * 0.55, L.hair);
    dot(ctx, [h[0] + f * r * 0.55, h[1] - r * 0.85], r * 0.55, L.hair);
  }
  dot(ctx, h, r, L.skin);
  // cabelo/acessórios na frente
  ctx.fillStyle = L.hair || L.skin;
  switch (L.hairStyle) {
    case 'headband': {
      ctx.beginPath(); ctx.arc(h[0], h[1], r, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
      ctx.fillRect(h[0] - r, h[1] - r * 0.25, r * 2 * 0.25, r * 0.3);
      ctx.fillStyle = L.accent;
      ctx.fillRect(h[0] - r, h[1] - r * 0.45, r * 2, r * 0.3);
      // pontas da faixa ao vento
      const tx = h[0] - f * r, ty = h[1] - r * 0.3;
      const wv = Math.sin(t * 0.25) * 3;
      ctx.strokeStyle = L.accent; ctx.lineWidth = 3 * s;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - f * 12 * s, ty + 3 + wv); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - f * 10 * s, ty + 8 - wv); ctx.stroke();
      break;
    }
    case 'buns':
      ctx.beginPath(); ctx.arc(h[0], h[1], r, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
      ctx.fillStyle = L.accent;
      ctx.fillRect(h[0] - f * r * 0.7 - 3, h[1] - r * 0.75 - 2, 6, 4);
      break;
    case 'flattop':
      ctx.fillStyle = '#141018';
      ctx.fillRect(h[0] - r - 1.5, h[1] - r * 1.75 - 1.5, r * 2 + 3, r * 1.15 + 3);
      ctx.fillStyle = L.hair;
      ctx.fillRect(h[0] - r, h[1] - r * 1.75, r * 2, r * 1.15);
      break;
    case 'mohawk':
      ctx.fillStyle = L.hair;
      ctx.fillRect(h[0] - r * 0.25, h[1] - r * 1.35, r * 0.5, r * 0.9);
      // barba
      ctx.beginPath(); ctx.arc(h[0] + f * r * 0.15, h[1] + r * 0.25, r * 0.75, 0, Math.PI); ctx.fill();
      break;
    case 'bald':
      ctx.fillStyle = L.accent;
      ctx.fillRect(h[0] + f * r * 0.35 - 1.5, h[1] - r * 0.6, 3, 4);
      break;
  }
  // olho
  ctx.fillStyle = '#141018';
  ctx.fillRect(h[0] + f * r * 0.45 - 1.5, h[1] - r * 0.12, 3, 3.5);
  if (L.hairStyle === 'wild') { // presas
    ctx.fillStyle = '#fff';
    ctx.fillRect(h[0] + f * r * 0.55 - 1, h[1] + r * 0.45, 2.5, 3.5);
  }
}

function spikes(ctx, x, y, r, n, t) {
  ctx.beginPath();
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const rr = i % 2 ? r * 0.62 : r * (1 + Math.sin(t * 0.2 + i) * 0.05);
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.fill();
}

/**
 * Desenha um lutador.
 * @param opts { x, y (chão sob o lutador), f (lado), pose, air, alpha, flash, shock, t }
 */
function drawFighter(ctx, c, opts) {
  const f = opts.f, pose = opts.pose, t = opts.t || 0;
  const P = points(c, pose, f);
  const s = c.body.scale;

  // posição: no chão, o ponto mais baixo encosta no chão
  let baseY;
  if (!opts.air && !pose.air) {
    let low = -Infinity;
    const rl = c.body.legW * s * 0.5, rh = c.body.headR * s;
    for (const k of ['ff', 'bf', 'fk', 'bk', 'hip', 'neck']) low = Math.max(low, P[k][1] + rl);
    low = Math.max(low, P.head[1] + rh);
    baseY = opts.y - low - (pose.lift || 0);
  } else {
    baseY = opts.y - c.hipH - (pose.lift || 0);
  }

  ctx.save();
  ctx.translate(opts.x, baseY);
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
  if (opts.shock) ctx.filter = (Math.floor(t / 3) % 2) ? 'invert(1) brightness(1.4)' : 'brightness(2)';
  else if (opts.flash) ctx.filter = 'brightness(2.6)';
  else if (opts.tint) ctx.filter = opts.tint;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const L = c.look;
  drawArm(ctx, c, P.sh, P.be, P.bh);
  drawLeg(ctx, c, f, P.hb, P.bk, P.bf);
  // tronco
  seg(ctx, mix(P.hip, P.neck, 0.02), P.neck, c.body.torsoW * s, L.torso || L.skin);
  if (L.chestHair) {
    ctx.fillStyle = 'rgba(80,40,20,.55)';
    const m = mix(P.hip, P.neck, 0.68);
    ctx.fillRect(m[0] - 3, m[1] - 3, 6, 6);
  }
  if (L.torso && L.hairStyle === 'buns') { // detalhe dourado do qipao
    seg(ctx, mix(P.hip, P.neck, 0.85), P.neck, 3, '#e5b931');
  }
  // faixa/cinto
  const bw = (L.beltW || 1) * 5 * s;
  ctx.lineCap = 'butt';
  seg(ctx, mix(P.hip, P.neck, -0.04), mix(P.hip, P.neck, bw / (c.body.torso * s)), c.body.torsoW * s + 1, L.belt);
  ctx.lineCap = 'round';
  if (L.necklace) {
    for (let i = -2; i <= 2; i++) {
      const p = mix(P.neck, P.hip, 0.18 + Math.abs(i) * -0.03);
      dot(ctx, [p[0] + i * 3.5 * s, p[1] + Math.abs(i) * -1.5], 2 * s, L.necklace);
    }
  }
  drawLeg(ctx, c, f, P.hf, P.fk, P.ff);
  drawHead(ctx, c, P, f, t);
  drawArm(ctx, c, P.sh, P.fe, P.fh);

  ctx.restore();
  return { P, baseY };
}

window.PANCADARIA = { CHARS, POSES, lerpPose, withPose, drawFighter, points };
})();
