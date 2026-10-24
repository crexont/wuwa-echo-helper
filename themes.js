// themes.js — 명조 툴즈 v5.0: 공명자 테마 색 (공명자를 고르면 화면 색이 이 색 기준으로 바뀐다)
//
// 고치는 법: 원하는 캐릭터 줄의 색만 바꾸면 된다. 한 줄에 캐릭터 하나.
// 색 하나로 바탕(검정 계열에 살짝 물든 색) · 강조색 · 글자색을 roles.js가 알아서 만든다.
// 색 기준(캐릭터 대표색 하나): 명조 채널 위키의 캐릭터 색(문서가 있는 26명) → 없으면 반신 일러스트에서 대표색 하나.
//   색이 두 개로 보이면 공식이 홍보 배경에 쓴 색 (샤콘=녹색, 카르티시아=남색, 페비=옷의 하늘색). 여우의 별자리=공식 배경의 진한 빨강. 방랑자는 속성 색.
//   참고: arca.live/b/wuwaarchive/138392697 (채널위키 캐릭터별 색상 정하는 기준)
// 일러스트는 img/theme/<그림 이름>.webp (방랑자 넷은 rover.webp 하나를 같이 쓴다).
export const THEME_COLORS = {
  'suoming':        '#d6404a',   // 쇄명
  'xin':            '#c8222a',   // 여우의 별자리
  'jingran':        '#4fc3c9',   // 경연
  'qingxiao':       '#6aa0e0',   // 청초
  'suisui':         '#e2c46e',   // 수수
  'rover-electro':  '#b46bff',   // 방랑자 · 전도
  'xuanling':       '#6fa8dc',   // 양양 · 현령
  'luosela':        '#7a5fc8',   // 루실라
  'luxi':           '#b48be0',   // 루시
  'libeika':        '#5fd9c0',   // 레베카
  'daniya':         '#f19ac0',   // 데니아
  'feixue':         '#c0303a',   // 히유키
  'xigelika':       '#f08a3c',   // 시그리카
  'luhesi':         '#3f9fb0',   // 루크 · 헤르센
  'aimisi':         '#ff7eb6',   // 에이메스
  'moning':         '#9aa8e0',   // 모니에
  'linnai':         '#7dd6db',   // 린네
  'buling':         '#94bfe0',   // 복링
  'qianxiao':       '#d8423e',   // 치사
  'qiuyuan':        '#3f8f62',   // 구원
  'jiabeilina':     '#3f6fc0',   // 갈브레나
  'younuo':         '#4a63b8',   // 유노
  'aogusita':       '#e0663a',   // 아우구스타
  'fuluoluo':       '#c63a48',   // 플로로
  'lupa':           '#d9506a',   // 루파
  'rover-aero':     '#55ffb5',   // 방랑자 · 기류
  'katixiya':       '#3154c9',   // 카르티시아
  'xiakong':        '#479885',   // 샤콘
  'zanni':          '#e6c67a',   // 젠니
  'kanteleila':     '#9b8ae6',   // 칸타렐라
  'bulante':        '#4aa6d6',   // 브렌트
  'feibi':          '#6aaee8',   // 페비
  'luokeke':        '#7d6ad6',   // 로코코
  'kelaita':        '#c92a63',   // 카를로타
  'dengdeng':       '#ec93ac',   // 루미
  'chun':           '#c73d45',   // 카멜리아
  'youhu':          '#88b4f2',   // 유호
  'shouanren':      '#5191e8',   // 파수인
  'xiangliyao':     '#5261c0',   // 상리요
  'zhezhi':         '#60b2bd',   // 절지
  'changli':        '#fc978f',   // 장리
  'jinxi':          '#b2dfe5',   // 금희
  'yinlin':         '#db5558',   // 음림
  'jiyan':          '#1ac3d0',   // 기염
  'yuanwu':         '#324683',   // 연무
  'kakaluo':        '#4f658c',   // 카카루
  'lingyang':       '#f5e9b3',   // 능양
  'danjin':         '#d3454b',   // 단근
  'sanhua':         '#373c45',   // 산화
  'jianxin':        '#b8eacb',   // 감심
  'jueyuan':        '#d3de79',   // 벨리나
  'mofeite':        '#b45142',   // 모르테피
  'anke':           '#feabb4',   // 앙코
  'taoqi':          '#eca5b7',   // 도기
  'qiushui':        '#c9cacc',   // 알토
  'baizhi':         '#5e5c64',   // 설지
  'yangyang':       '#6592f2',   // 양양
  'zhixia':         '#94383a',   // 치샤
  'rover-havoc':    '#e649a6',   // 방랑자 · 인멸
  'rover-spectro':  '#f8e56c',   // 방랑자 · 회절
};
