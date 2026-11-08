// 20 hand-tuned-by-formula levels. Everything NOVA can do scales with the level number.
export const LEVEL_COUNT = 20;

const NAMES = ['First Steps', 'Pointy Business', 'Mind the Gap', 'Squeeze', 'Swing Time', 'Hall of Hands', 'Funnel Vision',
  'Cannon Fodder', 'Leap of Faith', 'Two Lanes', 'Floor is Lava', 'Weak Spot', 'Overthinker', 'Crossfire', 'Narrow Escape',
  'She Learns', 'No Mercy', 'Glass Bridge', 'Endgame', 'NOVA Prime'];

export const TRAPS = {
  wall:     { cost: 1, unlock: 1,  label: 'Wall',     icon: '🧱' },
  spikes:   { cost: 2, unlock: 2,  label: 'Spikes',   icon: '🔺' },
  hammer:   { cost: 3, unlock: 5,  label: 'Hammer',   icon: '🔨' },
  cannon:   { cost: 3, unlock: 8,  label: 'Cannon',   icon: '💣' },
  collapse: { cost: 2, unlock: 11, label: 'Collapse', icon: '🕳️' },
};

const INTRO = {
  1: 'Run to the exit. I will try to stop you. Bonk my walls with F.',
  2: 'Spikes now. Jump them or go around.',
  3: 'The floor has holes. Jump them.',
  4: 'Stairs. Climbing is slow. Slow is good, for me.',
  7: 'Ice. Try stopping on that.',
  9: 'Bounce pads. You fly, I aim.',
  13: 'Moving platforms. You wait, I strike.',
  5: 'A hammer. It swings across the whole track. Time it.',
  6: 'I can chain traps now. Every move you make is information.',
  8: 'Cannons. The balls roll low, so jump.',
  11: 'I can make the floor fall away.',
  12: "I go after whoever is reviving. Teamwork has a price.",
  16: 'I remember how you dodge, even from earlier levels.',
  20: 'Everything I know. Good luck, little one.',
};

export function levelCfg(n, nightmare = false) {
  const t = (n - 1) / (LEVEL_COUNT - 1);
  const nm = nightmare ? 1 : 0;
  const rows = 26 + n * 3;
  const c = {
    n, name: NAMES[n - 1], nightmare, seed: n * 7919 + 13,
    rows,
    gapRate: n < 3 ? 0 : .05 + t * .07,
    narrowRate: n < 4 ? 0 : .05 + t * .16,
    pitRate: n < 9 ? 0 : t * .12,
    stairRate: n < 4 ? 0 : .05 + t * .06,       // climb up onto a plateau and back down
    iceRate: n < 7 ? 0 : .04 + t * .06,         // slippery rows
    bounceRate: n < 9 ? 0 : .03 + t * .04,      // pad launches you over a 3-row chasm
    shuttleRate: n < 13 ? 0 : .03 + t * .04,    // ride a moving platform across a chasm
    traps: Object.keys(TRAPS).filter(k => TRAPS[k].unlock <= n || nightmare),
    energyMax: 5 + t * 7 + nm * 3,
    regen: .4 + t * 1.3 + nm * .6,
    tele: Math.max(.6, (1.25 - t * .45) * (nightmare ? .8 : 1)),
    think: Math.max(.22, .95 - t * .6 - nm * .15),
    skill: Math.min(1, .3 + t * .65 + nm * .3),   // prediction + learned-habit exploitation
    combos: n >= 6 || nightmare,
    hunt: n >= 12 || nightmare,                     // attacks revivers / punishes Bonk cooldown
    maxThreats: 1 + (n >= 7) + (n >= 15) + nm,
    mercy: !nightmare,
    downT: 4 + t * 3,                               // seconds before a downed runner gets up alone
    grace: n === 1 ? 3 : 2,
    intro: INTRO[n] || null,
    newTrap: Object.keys(TRAPS).find(k => TRAPS[k].unlock === n) || null,
  };
  c.par = Math.round(rows * 2 / 4.1 + 4 + Math.pow(n, 1.6) * .25);   // later levels: NOVA forces more waiting
  return c;
}
