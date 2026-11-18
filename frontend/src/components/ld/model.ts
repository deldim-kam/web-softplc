import type { LdRung, LdElement, LdElementType } from '../../types/plc';
import { isContactType, isCoilType, isCmpType, canHaveParallel } from './constants';

const uid = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export function createElement(
  type: LdElementType,
  defaultBool = '"Line_Params".Line_Enable',
  defaultNum = '"Line_Params".Target_Speed'
): LdElement {
  return {
    id: uid('el'),
    type,
    operand1:
      type === 'TON' || type === 'TOF'
        ? '1000'
        : isContactType(type) || isCoilType(type) || type === 'CTU' || type === 'CTD'
        ? defaultBool
        : defaultNum,
    operand2:
      isCmpType(type) || type === 'ADD' || type === 'SUB' || type === 'MUL' || type === 'DIV'
        ? '100.0'
        : type === 'CTU' || type === 'CTD'
        ? '10'
        : undefined,
    operand3:
      type === 'ADD' || type === 'SUB' || type === 'MUL' || type === 'DIV' || type === 'CTU' || type === 'CTD'
        ? defaultNum
        : type === 'TON' || type === 'TOF'
        ? defaultBool
        : undefined,
  };
}

export function cloneElementWithNewIds(el: LdElement): LdElement {
  return {
    ...el,
    id: uid('el'),
    parallel: el.parallel?.map((p) => ({ ...p, id: uid('par') })),
  };
}

export function insertElementInRungs(
  rungs: LdRung[],
  rungIdx: number,
  insertPos: number,
  newEl: LdElement
): LdRung[] {
  return rungs.map((r, i) => {
    if (i !== rungIdx) return r;
    const els = [...r.elements];
    const pos = Math.max(0, Math.min(els.length, insertPos));
    els.splice(pos, 0, newEl);
    return { ...r, elements: els };
  });
}

export function updateElementInRungs(
  rungs: LdRung[],
  rungIdx: number,
  elIdx: number,
  patch: Partial<LdElement>
): LdRung[] {
  return rungs.map((r, rI) =>
    rI !== rungIdx
      ? r
      : { ...r, elements: r.elements.map((el, eI) => (eI === elIdx ? { ...el, ...patch } : el)) }
  );
}

export function removeElementFromRungs(rungs: LdRung[], rungIdx: number, elIdx: number): LdRung[] {
  return rungs.map((r, rI) =>
    rI !== rungIdx ? r : { ...r, elements: r.elements.filter((_, eI) => eI !== elIdx) }
  );
}

export function moveElementInRungs(
  rungs: LdRung[],
  rungIdx: number,
  elIdx: number,
  dir: -1 | 1
): { rungs: LdRung[]; newIdx: number } {
  const r = rungs[rungIdx];
  if (!r) return { rungs, newIdx: elIdx };
  const target = elIdx + dir;
  if (target < 0 || target >= r.elements.length) return { rungs, newIdx: elIdx };

  const next = rungs.map((item, rI) => {
    if (rI !== rungIdx) return item;
    const els = [...item.elements];
    const [moved] = els.splice(elIdx, 1);
    els.splice(target, 0, moved);
    return { ...item, elements: els };
  });
  return { rungs: next, newIdx: target };
}

export function addParallelToElement(
  rungs: LdRung[],
  rungIdx: number,
  elIdx: number,
  branchType: LdElementType,
  defaultBool: string,
  defaultNum: string
): LdRung[] {
  return rungs.map((r, rI) => {
    if (rI !== rungIdx) return r;
    return {
      ...r,
      elements: r.elements.map((el, eI) => {
        if (eI !== elIdx || !canHaveParallel(el.type)) return el;
        const par = el.parallel ? [...el.parallel] : [];
        par.push({
          id: uid('par'),
          type: branchType,
          operand1: isCmpType(branchType) ? defaultNum : defaultBool,
          operand2: isCmpType(branchType) ? '100.0' : undefined,
        });
        return { ...el, parallel: par };
      }),
    };
  });
}

export function insertRungAt(rungs: LdRung[], pos: number): LdRung[] {
  const next = [...rungs];
  next.splice(pos, 0, {
    id: uid('rung'),
    title: `Цепь ${rungs.length + 1}: Логическая цепь`,
    elements: [],
  });
  return next;
}

export function duplicateRungAt(rungs: LdRung[], rIdx: number): LdRung[] {
  const src = rungs[rIdx];
  if (!src) return rungs;
  const copy: LdRung = {
    id: uid('rung'),
    title: `${src.title} (Копия)`,
    elements: src.elements.map(cloneElementWithNewIds),
  };
  const next = [...rungs];
  next.splice(rIdx + 1, 0, copy);
  return next;
}

export function moveRungInList(rungs: LdRung[], rIdx: number, dir: -1 | 1): { rungs: LdRung[]; newIdx: number } {
  const target = rIdx + dir;
  if (target < 0 || target >= rungs.length) return { rungs, newIdx: rIdx };
  const next = [...rungs];
  const [item] = next.splice(rIdx, 1);
  next.splice(target, 0, item);
  return { rungs: next, newIdx: target };
}
