// js/data.js
export const STAT_DATABASE = {
  "크피": { name: "크리티컬 피해", isPercent: true, matchRegex: /크.*피|피해/, notRegex: /일반|강공|스킬|해방/, values: [12.6, 13.8, 15.0, 16.2, 17.4, 18.6, 19.8, 21.0] },
  "크확": { name: "크리티컬 확률", isPercent: true, matchRegex: /크.*확|확률/, notRegex: /피해/, values: [6.3, 6.9, 7.5, 8.1, 8.7, 9.3, 9.9, 10.5] },
  "공효": { name: "공명 효율", isPercent: true, matchRegex: /효율|공효/, notRegex: null, values: [6.8, 7.6, 8.4, 9.2, 10.0, 10.8, 11.6, 12.4] },
  "일공피": { name: "일반 공격 피해", isPercent: true, matchRegex: /일반/, notRegex: null, values: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6] },
  "강공피": { name: "강공격 피해", isPercent: true, matchRegex: /강공/, notRegex: null, values: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6] },
  "스킬피": { name: "공명 스킬 피해", isPercent: true, matchRegex: /스킬/, notRegex: null, values: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6] },
  "해방피": { name: "공명 해방 피해", isPercent: true, matchRegex: /해방|공명해방/, notRegex: null, values: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6] },
  "공%": { name: "공격력%", isPercent: true, matchRegex: /공격|공력|공극|0격/, notRegex: /일반|강공/, values: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6] },
  "체%": { name: "HP%", isPercent: true, matchRegex: /HP|생명|체력/, notRegex: null, values: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6] },
  "방%": { name: "방어력%", isPercent: true, matchRegex: /방어|방력/, notRegex: null, values: [8.1, 9.0, 10.0, 10.9, 11.8, 12.8, 13.8, 14.7] },
  "깡공": { name: "공격력 (고정)", isPercent: false, matchRegex: /공격|공력|공극|0격/, notRegex: /일반|강공/, values: [30, 40, 50, 60] },
  "깡체": { name: "HP (고정)", isPercent: false, matchRegex: /HP|생명|체력/, notRegex: null, values: [320, 360, 390, 430, 470, 510, 540, 580] },
  "깡방": { name: "방어력 (고정)", isPercent: false, matchRegex: /방어|방력/, notRegex: null, values: [40, 50, 60, 70] }
};

export const DEFAULT_TARGETS = ["크확", "크피", "공%", "공효"];
export const GOAL_PRESETS = [
  { id: 'crit_0', title: '쌍크 (크크)', type: 'crit', req: 0 },
  { id: 'crit_1', title: '크크 + 1유효', type: 'crit', req: 1 },
  { id: 'crit_2', title: '크크 + 2유효', type: 'crit', req: 2 },
  { id: 'crit_3', title: '크크 + 3유효', type: 'crit', req: 3 },
  { id: 'free_2', title: '서포터 2유효', type: 'free', req: 2 },
  { id: 'free_3', title: '서포터 3유효', type: 'free', req: 3 }
];