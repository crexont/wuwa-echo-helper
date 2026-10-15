// config.js — 명조 에코파고 v3.0: 여러 파일이 함께 쓰는 설정값
export const SLOT_COUNT = 5;
export const SPLIT_X = 0.65;          // 슬롯 폭 중 옵션명 / 수치 경계
export const DEBUG = new URLSearchParams(location.search).has('debug');   // ?debug 로 열면 OCR 과정을 콘솔에 출력
export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
