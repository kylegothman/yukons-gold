import type { Command } from '../sim/commands';
import { Item, Unit, isContainer, isDigger, isFixture, isStation, isTank, isVehicle, isWash, itemById, tileAt, tileLevel } from '../sim/state';
import { operatorOf } from '../sim/systems/jobs';
import { wet } from '../sim/systems/machines';
import type { Session } from './session';

export interface Action { label: string; cmd: Command; strong: boolean }

export const ITEM_NAME: Record<string, string> = { bucket: 'bucket', barrow: 'wheelbarrow', sieve: 'sieve', pan: 'gold pan', sluice: 'sluice box', excavator: 'mini excavator', excavator2: 'mid excavator', excavator3: 'large excavator', excavator4: 'mining excavator', dozer: 'dozer', truck: 'dump truck', fueltruck: 'fuel truck', trommel: 'trommel', washplant: 'wash plant', crusher: 'crusher', mill: 'mill', pump: 'pump', tank: 'diesel tank', tank2: '500-gallon tank', tank3: '2,000-gallon tank', atv: 'ATV' };

// What a right-click means for one unit. Used for both the cursor hint and the command sent.
export function decide(ses: Session, u: Unit, tx: number, ty: number, fx: number, fy: number, item: Item | undefined, shift: boolean): Action {
  const s = ses.state, p = ses.me;
  const carried = itemById(s, u.carrying);
  const t = tileAt(s, tx, ty);
  const move: Action = { label: 'Walk here', cmd: { c: 'move', p, units: [u.id], x: fx, y: fy }, strong: false };
  // In a machine: drive it, or put it to work on the claim.
  if (u.vehicle >= 0) {
    const vk = itemById(s, u.vehicle)?.kind ?? '';
    if (t && !t.water && t.owner === p) {
      const label = isDigger(vk as never) ? 'Excavate here on repeat' : vk === 'dozer' ? 'Rip the brown layer on this claim' : vk === 'truck' ? 'Haul for the excavator working here' : 'Keep the machines on this claim fuelled';
      if (!isDigger(vk as never) || tileLevel(t) < 5) return { label, cmd: { c: 'job', p, units: [u.id], job: { type: 'dig', tx, ty } }, strong: true };
    }
    return { ...move, label: 'Drive here' };
  }
  if (item && isVehicle(item.kind)) {
    const name = ITEM_NAME[item.kind];
    if (u.boss) return { ...move, label: `Only hired hands drive machines: select one and right-click the ${name}` };
    if (item.driver >= 0) return { ...move, label: 'Someone is already driving it' };
    return { label: `Climb in and drive the ${name}`, cmd: { c: 'drive', p, unit: u.id, item: item.id }, strong: true };
  }
  if (item && (item.kind === 'trommel' || item.kind === 'washplant')) {
    if (carried && isContainer(carried.kind) && carried.contents === 'paydirt') return { label: 'Tip pay dirt into the hopper', cmd: { c: 'use', p, unit: u.id, station: item.id }, strong: true };
    return { ...move, label: `${item.kind === 'trommel' ? 'Trommel' : 'Wash plant'}: runs itself. Feed it with an excavator, a truck or a bucket of pay dirt` };
  }
  if (item && (item.kind === 'crusher' || item.kind === 'mill')) return { ...move, label: item.kind === 'crusher' ? 'Crusher: takes bedrock ore from a mining excavator, feeds a touching mill' : 'Mill: fed by a touching crusher, feeds a touching wash plant' };
  if (item && (item.kind === 'pump' || isTank(item.kind))) return { ...move, label: isTank(item.kind) ? 'Diesel tank: left-click it to refill' : 'Pump: waters pans, sluices and wash plants within 10 tiles' };
  if (item) {
    const name = ITEM_NAME[item.kind];
    if (isStation(item.kind)) {
      if (!u.boss) return { label: `Staff the ${name} full time`, cmd: { c: 'job', p, units: [u.id], job: { type: 'operate', station: item.id } }, strong: true };
      if (shift) return { label: `Pick up the ${name} to move it`, cmd: { c: 'pickup', p, unit: u.id, item: item.id }, strong: true };
      const hand = operatorOf(s, item.id);
      if (hand && carried && isContainer(carried.kind) && carried.contents !== 'empty' && (isWash(item.kind) || carried.contents === 'paydirt'))
        return { label: `Drop this off for ${hand.name} to ${item.kind === 'sieve' ? 'screen' : 'wash'}`, cmd: { c: 'use', p, unit: u.id, station: item.id }, strong: true };
      const verb = item.kind === 'sieve' ? 'Screen dirt at the sieve' : isWash(item.kind) && !wet(s, item.x, item.y, p) ? `${name} needs creek water (Shift+right-click to move it)` : `Wash dirt in the ${name}`;
      return { label: verb, cmd: { c: 'use', p, unit: u.id, station: item.id }, strong: true };
    }
    return { label: `Pick up the ${name}`, cmd: { c: 'pickup', p, unit: u.id, item: item.id }, strong: true };
  }
  if (!t) return move;
  if (u.boss && carried && isFixture(carried.kind)) {
    const dry = isWash(carried.kind) && !wet(s, tx, ty, p);
    return { label: dry ? `Set down the ${ITEM_NAME[carried.kind]} (it only works beside the creek)` : `Set up the ${ITEM_NAME[carried.kind]} here`, cmd: { c: 'place', p, unit: u.id, x: tx, y: ty }, strong: true };
  }
  const diggable = !t.water && t.owner === p && t.organicLeft > 0;
  if (!u.boss && diggable) return { label: 'Mine here: dig, screen and wash on repeat', cmd: { c: 'job', p, units: [u.id], job: { type: 'dig', tx, ty } }, strong: true };
  if (u.boss && carried && isContainer(carried.kind) && carried.contents === 'empty') {
    if (diggable) return { label: 'Dig here', cmd: { c: 'dig', p, unit: u.id, tx, ty }, strong: true };
    if (!t.water && t.owner !== p) return { ...move, label: 'Walk here (not your claim, so no digging)' };
  }
  return move;
}
