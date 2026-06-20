'use strict';

const LEVEL_MULT = [2.00, 3.00, 4.00, 5.00, 6.00];

function correctWeapon(kind, weapon) {
  kind = String(kind || '').toLowerCase();
  weapon = String(weapon || '').toUpperCase();
  if (/sam|emitter|radar|tel/.test(kind)) return /AGM-88|HARM/.test(weapon) ? 'full' : (/AGM|65|MK-82|BOMB|LGB/.test(weapon) ? 'partial' : 'wrong');
  if (/mover|ground|vehicle/.test(kind)) return /AGM-65|MAVERICK|65|LGB/.test(weapon) ? 'full' : (/MK-82|BOMB|HARM/.test(weapon) ? 'partial' : 'wrong');
  if (/hvt|structure|building|primary/.test(kind)) return /MK-82|BOMB|LGB|AGM-65|65/.test(weapon) ? 'full' : (/HARM/.test(weapon) ? 'partial' : 'wrong');
  if (/bandit|air/.test(kind)) return /AIM|9X|120|GUN/.test(weapon) ? 'full' : 'wrong';
  return 'partial';
}

function computeVerifiedScore(record) {
  const events = (record.replay && record.replay.events) || [];
  const levelIndex = Math.max(0, Math.min(4, (record.mission.level || 1) - 1));
  const outcome = record.mission.outcome || 'LOSS';
  const reason = record.mission.outcomeReason || '';

  let takeoff = false;
  let flareCount = 0;
  let damage = 0;
  let manualPenalty = 0;
  const waypoints = new Map();
  const weapons = [];
  const kills = [];

  for (const ev of events) {
    if (!ev || !ev.type) continue;
    const type = String(ev.type);
    const data = ev.data || {};
    if (type === 'takeoff') takeoff = true;
    else if (type === 'waypoint' || type === 'waypoint_advanced') waypoints.set(String(data.id || data.steerpoint || waypoints.size + 1), true);
    else if (type === 'flare') flareCount++;
    else if (type === 'player_damaged' || type === 'damage') damage += Math.max(0, Number(data.amount || 0) || 0);
    else if (type === 'penalty') manualPenalty += Math.max(0, Number(data.points || 0) || 0);
    else if (type === 'weapon_fired') {
      if (data.weapon === 'RED_AAM' || (data.actor && data.actor !== 'player')) continue;
      weapons.push({ weapon: String(data.weapon || 'UNKNOWN'), targetType: String(data.targetType || data.kind || data.targetKind || '') });
    } else if (type === 'kill' || type === 'target_destroyed') {
      const kind = String(data.targetType || data.kind || 'target');
      const weapon = String(data.weapon || (weapons[weapons.length - 1] && weapons[weapons.length - 1].weapon) || 'UNKNOWN');
      kills.push({
        kind,
        weapon,
        primary: !!data.primary || data.targetType === 'primary',
        name: String(data.targetName || data.name || ''),
        correct: correctWeapon(kind, weapon)
      });
    }
  }

  let primary = 0;
  let secondary = 0;
  let air = 0;
  let sam = 0;
  let weaponDisc = 0;

  for (const k of kills) {
    const kind = String(k.kind || '').toLowerCase();
    if (k.primary || /primary/.test(kind)) primary += 4000;
    else if (/bandit|air/.test(kind)) air += /HVA|MAINSTAY/i.test(k.name) ? 1200 : 800;
    else if (/sam|emitter|radar|tel/.test(kind)) sam += 850;
    else if (/hvt/.test(kind)) secondary += 800;
    else if (/mover|ground|vehicle/.test(kind)) secondary += 550;
    else if (/structure/.test(kind)) secondary += 700;
    else secondary += 300;
    weaponDisc += k.correct === 'full' ? 220 : (k.correct === 'partial' ? 90 : -140);
  }

  const waypointDiscipline = Math.min(1200, waypoints.size * 180);
  const takeoffScore = takeoff ? 300 : 0;
  const lastSnapshot = record.replay.snapshots[record.replay.snapshots.length - 1] || {};
  const integrity = lastSnapshot.ac && Number(lastSnapshot.ac.integrity);
  const aliveAtEnd = !Number.isFinite(integrity) || integrity > 0;
  const survival = aliveAtEnd ? (outcome === 'WIN' ? 1000 : 250) : 0;
  const shots = weapons.filter(w => !/GUN|FLARE/.test(w.weapon)).length;
  const nonGunKills = kills.filter(k => !/GUN/.test(k.weapon)).length;
  const misses = Math.max(0, shots - nonGunKills);

  let penalties = 0;
  penalties -= misses * 140;
  penalties -= Math.max(0, flareCount - 8) * 15;
  penalties -= Math.round(damage * 8);
  penalties -= manualPenalty;
  if (outcome !== 'WIN') penalties -= 300;
  if (/CRASH|TERRAIN|DESTROYED|LANDING|IMPACT|DEAD/i.test(reason || outcome)) penalties -= 1200;

  const breakdown = {
    primaryTargets: primary,
    secondaryTargets: secondary,
    enemyAircraft: air,
    samSites: sam,
    waypointDiscipline,
    weaponDiscipline: weaponDisc,
    takeoff: takeoffScore,
    survival,
    penalties
  };

  const raw = Math.max(0, Object.values(breakdown).reduce((a, b) => a + (Number(b) || 0), 0));
  const levelMultiplier = LEVEL_MULT[levelIndex] || 1;
  const outcomeMultiplier = outcome === 'WIN' ? 1 : (/CRASH|TERRAIN|DESTROYED|LANDING|IMPACT|DEAD/i.test(reason || outcome) ? 0.20 : 0.40);
  const total = Math.max(0, Math.round(raw * levelMultiplier * outcomeMultiplier));
  breakdown.raw = raw;
  breakdown.levelMultiplier = levelMultiplier;
  breakdown.outcomeMultiplier = outcomeMultiplier;

  return {
    total,
    breakdown,
    verified: true,
    serverScoredAt: new Date().toISOString(),
    stats: {
      kills: kills.length,
      shots,
      waypoints: waypoints.size,
      flareCount,
      damage: Math.round(damage * 100) / 100
    }
  };
}

module.exports = { computeVerifiedScore };
