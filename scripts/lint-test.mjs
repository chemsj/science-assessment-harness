#!/usr/bin/env node
// lint.mjs 자가 시험 — 하드룰 위반 데이터를 임시 샌드박스에 주입해 lint가 잡는지 확인한다.
// 사용법: node scripts/lint-test.mjs   (lint.mjs를 수정하면 반드시 통과시킬 것)
// 원리: 임시 폴더에 lint.mjs + references(JSON) + 합성 과제 픽스처를 복사하고,
//   테스트마다 위반을 하나씩 주입해 lint 출력에서 검출 여부를 판정한다.
//   픽스처의 성취기준 코드·원문은 references/성취기준/화학.json에서 실시간으로 꺼내 쓴다
//   (원문을 여기 하드코딩하지 않는다 — 사실은 데이터에서).
import { rmSync, unlinkSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = join(tmpdir(), `lint-test-${process.pid}`);
const TASK = '화학-검증전용테스트';
const DEST = join(SANDBOX, 'assessments', TASK);

// node 24.11.0의 fs.cpSync가 일부 환경(한글 경로 재귀 복사)에서 크래시해 수동 복사 사용
function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name), d = join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}
const readJ = (p) => JSON.parse(readFileSync(p, 'utf-8'));
const writeJ = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2));
const patch = (p, from, to) => {
  const t = readFileSync(p, 'utf-8');
  if (!t.includes(from)) throw new Error(`픽스처 패치 실패: '${String(from).slice(0, 30)}…' 없음 — ${p}`);
  writeFileSync(p, t.replaceAll(from, to));
};

// ── 샌드박스 준비: lint + references(JSON만) 복사 ──
rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(join(SANDBOX, 'scripts'), { recursive: true });
mkdirSync(join(SANDBOX, 'references', '성취기준'), { recursive: true });
mkdirSync(join(SANDBOX, 'references', '평가기준'), { recursive: true });
copyFileSync(join(ROOT, 'scripts', 'lint.mjs'), join(SANDBOX, 'scripts', 'lint.mjs'));
copyFileSync(join(ROOT, 'references', '교과목록.json'), join(SANDBOX, 'references', '교과목록.json'));
// 성취기준·평가기준(있으면) 원본 복사 — 코드 대조 검증(2·2c)의 근거
function copyRefDir(sub) {
  const src = join(ROOT, 'references', sub);
  if (!existsSync(src)) return;
  for (const f of readdirSync(src).filter((x) => x.endsWith('.json')))
    copyFileSync(join(src, f), join(SANDBOX, 'references', sub, f));
}
copyRefDir('성취기준');
copyRefDir('평가기준');

// ── 합성 픽스처: 성취기준 원문은 references에서 실시간 인용 ──
const chem = readJ(join(ROOT, 'references', '성취기준', '화학.json'));
const codeText = new Map(chem.영역.flatMap((a) => a.성취기준.map((c) => [c.코드, c.내용])));
const CODE1 = '[12화학01-01]', CODE2 = '[12화학01-03]';
const TEXT1 = codeText.get(CODE1), TEXT2 = codeText.get(CODE2);
if (!TEXT1 || !TEXT2) { console.error(`전제 실패: ${CODE1}/${CODE2}가 성취기준/화학.json에 없음`); process.exit(1); }

function writeFixture(d) {
  mkdirSync(join(d, '수행기록'), { recursive: true });
  mkdirSync(join(d, '산출물'), { recursive: true });
  writeJ(join(d, 'meta.json'), {
    과목코드: '화학', 묶음: '일반선택', 평가방식: '상대평가',
    단원: '검증전용테스트', 성취기준코드: [CODE1, CODE2],
  });
  // 루브릭은 html/json 쌍 — html은 json에서 생성해 배점·기술을 완전히 일치시킨다(쌍 일치 검사 대상)
  const rubric = {
    과목코드: '화학', 단원: '검증전용테스트', 유형: '분석적', 만점: 100,
    수준명: ['우수', '보통', '미흡'],
    평가요소: [
      { 요소: '사례 조사·발표', 약칭: '사례발표', 성취기준코드: CODE1,
        수준: { 우수: { 배점: 30, 기술: '사례를 근거와 함께 발표한다.' }, 보통: { 배점: 20, 기술: '사례를 발표하나 근거가 일부 부족하다.' }, 미흡: { 배점: 10, 기술: '사례 조사가 단편적이다.' } } },
      { 요소: '양적 관계 탐구', 약칭: '양적관계', 성취기준코드: CODE2,
        수준: { 우수: { 배점: 70, 기술: '계수비를 근거로 양적 관계를 설명한다.' }, 보통: { 배점: 50, 기술: '반응식 작성은 가능하나 설명이 일부 미흡하다.' }, 미흡: { 배점: 30, 기술: '반응식 작성에 도움이 필요하다.' } } },
    ],
  };
  writeJ(join(d, '루브릭.json'), rubric);
  writeFileSync(join(d, '루브릭.html'),
    '<html><body><h1>루브릭 — 검증전용테스트</h1><table>'
    + rubric.평가요소.map((el) =>
        `<tr><td>${el.요소}</td>` + rubric.수준명.map((lv) => `<td>(${el.수준[lv].배점}점) ${el.수준[lv].기술}</td>`).join('') + '</tr>').join('')
    + '</table></body></html>\n');
  writeFileSync(join(d, '수행기록', '관찰기록-1반.csv'),
    '번호,날짜,관찰한 사실,관련 역량\n'
    + '3,6.9,사례 3가지를 출처와 함께 발표함,자료조사\n'
    + '3,6.16,계수비를 근거로 생성량을 계산함,양적사고\n'
    + '7,6.16,환산 4문항을 해결하고 오답을 수정함,양적사고\n');
  writeFileSync(join(d, '산출물', '채점표-1반.csv'),
    '번호,사례발표_수준,사례발표_점수,사례발표_근거,양적관계_수준,양적관계_점수,양적관계_근거,합계,비고\n'
    + '3,우수,30,6.9 사례 3가지를 출처와 함께 발표,우수,70,6.16 계수비로 생성량 계산,100,\n'
    + '7,[확인 필요],[확인 필요],[확인 필요],보통,50,6.16 환산 4문항 해결(일부 오류),[확인 필요],사례발표 기록 없음 — 보완 관찰 필요\n');
  writeFileSync(join(d, '산출물', '과세특-초안-1반.md'),
    '# 과세특 초안 — 검증전용테스트 1반\n\n## 3번\n화학의 기여 사례를 조사하여 근거와 함께 발표하고, 계수비를 근거로 양적 관계를 설명함.\n');
  writeFileSync(join(d, '평가계획서.html'),
    `<html><body><h1>평가계획서 — 검증전용테스트</h1><table>
<tr><td><span class="code">${CODE1}</span></td><td>${TEXT1}</td></tr>
<tr><td><span class="code">${CODE2}</span></td><td>${TEXT2}</td></tr>
</table></body></html>\n`);
  writeFileSync(join(d, '활동지.html'),
    `<html><body><h1>활동지 — 검증전용테스트</h1>
<p>탐구 목표: ${TEXT2} <span class="code">${CODE2}</span></p>
</body></html>\n`);
}

// ── 테스트 목록: mutate가 위반 주입, pattern이 '잡았다'로 인정할 정규식 ──
// control: true 는 오탐 검사(변조해도 통과해야 함)
const tests = [
  { id: 'T0', name: '대조군(무변조) — 통과해야 함', control: true,
    mutate: () => {}, pattern: /✅ 통과 — 오류 0, 경고 0/ },
  { id: 'T1', name: 'meta.json에 가짜 성취기준 코드',
    mutate: (d) => { const m = readJ(join(d, 'meta.json')); m.성취기준코드.push('[12화학99-99]'); writeJ(join(d, 'meta.json'), m); },
    pattern: /실재하지 않음/ },
  { id: 'T2', name: '루브릭 만점 ≠ 최고수준 배점 합',
    mutate: (d) => { const r = readJ(join(d, '루브릭.json')); r.만점 = 90; writeJ(join(d, '루브릭.json'), r); },
    pattern: /배점 합 .* ≠ 만점/ },
  { id: 'T3', name: '루브릭에 만점 키 없음',
    mutate: (d) => { const r = readJ(join(d, '루브릭.json')); delete r.만점; writeJ(join(d, '루브릭.json'), r); },
    pattern: /만점이 없거나/ },
  { id: 'T4', name: '루브릭 수준 배점 역전(미흡>우수)',
    mutate: (d) => { const r = readJ(join(d, '루브릭.json')); const el = r.평가요소[0]; el.수준.우수.배점 = 10; el.수준.미흡.배점 = 30; writeJ(join(d, '루브릭.json'), r); },
    pattern: /배점 역전/ },
  { id: 'T5', name: '관찰기록 번호 열에 실명',
    mutate: (d) => appendFileSync(join(d, '수행기록', '관찰기록-1반.csv'), '김철수,6.9,발표 자료를 정리함,협업\n'),
    pattern: /숫자만 허용/ },
  { id: 'T6', name: "관찰기록 '사실'에 평가어",
    mutate: (d) => appendFileSync(join(d, '수행기록', '관찰기록-1반.csv'), '3,6.9,발표를 잘함,의사소통\n'),
    pattern: /평가어/ },
  { id: 'T7', name: '관찰기록 날짜 형식 위반',
    mutate: (d) => appendFileSync(join(d, '수행기록', '관찰기록-1반.csv'), '3,어제,반응식 검산 방법을 물어봄,모형화\n'),
    pattern: /날짜 '어제'/ },
  { id: 'T8', name: '채점표 점수 ≠ 루브릭 배점',
    mutate: (d) => patch(join(d, '산출물', '채점표-1반.csv'), '3,우수,30,', '3,우수,25,'),
    pattern: /≠ 루브릭 배점/ },
  { id: 'T9', name: '채점표 점수에 근거 없음',
    mutate: (d) => patch(join(d, '산출물', '채점표-1반.csv'), '6.9 사례 3가지를 출처와 함께 발표', ''),
    pattern: /근거 없음/ },
  { id: 'T10', name: '관찰기록엔 있는 학생이 채점표에서 누락',
    mutate: (d) => { const p = join(d, '산출물', '채점표-1반.csv'); writeFileSync(p, readFileSync(p, 'utf-8').split('\n').filter((l) => !l.startsWith('7,')).join('\n')); },
    pattern: /채점표에 없음/ },
  { id: 'T11', name: '채점표 번호 중복 행',
    mutate: (d) => { const p = join(d, '산출물', '채점표-1반.csv'); const t = readFileSync(p, 'utf-8'); appendFileSync(p, t.split('\n').find((l) => l.startsWith('3,')) + '\n'); },
    pattern: /중복 행/ },
  { id: 'T12', name: '과세특에 금지표현(수상)',
    mutate: (d) => appendFileSync(join(d, '산출물', '과세특-초안-1반.md'), '\n교외 발명대회 수상 실적이 있음.\n'),
    pattern: /금지 표현 '수상'/ },
  { id: 'T13', name: '과세특 분량 초과(한글 600자=1,800Byte > 1,500Byte)',
    mutate: (d) => appendFileSync(join(d, '산출물', '과세특-초안-1반.md'), '\n' + '가'.repeat(600) + '\n'),
    pattern: /Byte > 1500Byte/ },
  { id: 'T14', name: '평가계획서.html에 가짜 성취기준 코드',
    mutate: (d) => patch(join(d, '평가계획서.html'), CODE1, '[12화학99-99]'),
    pattern: /실재하지 않음/ },
  { id: 'T15', name: '활동지.html 성취기준 원문 각색(코드 병기)',
    mutate: (d) => patch(join(d, '활동지.html'), TEXT2, TEXT2.slice(0, Math.floor(TEXT2.length / 2)) + '…(각색)'),
    pattern: /원문 전문이 파일에 없음/ },
  { id: 'T16', name: 'meta.json에 평가방식 누락',
    mutate: (d) => { const m = readJ(join(d, 'meta.json')); delete m.평가방식; writeJ(join(d, 'meta.json'), m); },
    pattern: /평가방식 없음/ },
  { id: 'T17', name: '과세특에 금지표현(장학금)',
    mutate: (d) => appendFileSync(join(d, '산출물', '과세특-초안-1반.md'), '\n교내 장학금을 받아 학업을 이어감.\n'),
    pattern: /금지 표현 '장학금'/ },
  { id: 'T18', name: 'meta.json에 성취기준코드 없음',
    mutate: (d) => { const m = readJ(join(d, 'meta.json')); delete m.성취기준코드; writeJ(join(d, 'meta.json'), m); },
    pattern: /성취기준코드가 없거나 비어 있음/ },
  { id: 'T19', name: '채점표 [확인 필요] 행의 합계가 숫자',
    mutate: (d) => patch(join(d, '산출물', '채점표-1반.csv'), '[확인 필요],사례발표 기록 없음', '77,사례발표 기록 없음'),
    pattern: /미채점 요소가 있는데 합계가/ },
  { id: 'T20', name: '관찰기록 헤더 열 순서 뒤바뀜',
    mutate: (d) => patch(join(d, '수행기록', '관찰기록-1반.csv'), '번호,날짜,관찰한 사실,관련 역량', '날짜,번호,관찰한 사실,관련 역량'),
    pattern: /헤더 .* 양식.*과 다름/ },
  { id: 'T21', name: '오탐 확인: 원문이 태그로 쪼개져 있어도 통과', control: true,
    mutate: (d) => patch(join(d, '활동지.html'), TEXT2, TEXT2.slice(0, 5) + '<b>' + TEXT2.slice(5, 12) + '</b>' + TEXT2.slice(12)),
    pattern: /✅ 통과 — 오류 0, 경고 0/ },
  { id: 'T22', name: '루브릭 약칭에 쉼표(채점표 헤더 오염)',
    mutate: (d) => { const r = readJ(join(d, '루브릭.json')); r.평가요소[0].약칭 = '사례,발표'; writeJ(join(d, '루브릭.json'), r); },
    pattern: /헤더가 루브릭/ },
  { id: 'T23', name: '루브릭.html만 있고 루브릭.json 없음(기계용 쌍 누락)',
    // rmSync(단일 파일)는 이 PC Node 24.11.0에서 한글 경로 크래시(0xC0000409) — unlinkSync로 우회
    mutate: (d) => unlinkSync(join(d, '루브릭.json')),
    pattern: /루브릭\.json 없음 — 기계용 쌍 필수/ },
  { id: 'T24', name: 'meta.json 묶음이 교과목록과 불일치',
    mutate: (d) => { const m = readJ(join(d, 'meta.json')); m.묶음 = '진로선택'; writeJ(join(d, 'meta.json'), m); },
    pattern: /묶음 '진로선택'이 과목\(일반선택\)과 불일치/ },
  { id: 'T25', name: '교과목록이 없는 성취기준 파일을 참조(깨진 경로)',
    // references를 변조하므로 러너가 매 테스트 전 교과목록.json을 재복사한다(아래 실행 루프)
    mutate: (d) => {
      const p = join(d, '..', '..', 'references', '교과목록.json');
      const cat = readJ(p);
      cat.과목.find((s) => s.코드 === '물리학').성취기준파일 = '성취기준/없는파일.json';
      writeJ(p, cat);
    },
    pattern: /성취기준파일 '성취기준\/없는파일\.json' 없음/ },
  { id: 'T26', name: '루브릭.html 기술이 루브릭.json과 다름(쌍 불일치)',
    mutate: (d) => patch(join(d, '루브릭.html'), '계수비를 근거로 양적 관계를 설명한다.', '양적 관계를 대체로 설명한다.'),
    pattern: /루브릭\.json과 다름/ },
  { id: 'T27', name: 'meta.json 산출물 목록에 실재하지 않는 파일',
    mutate: (d) => { const m = readJ(join(d, 'meta.json')); m.산출물 = ['없는파일.html']; writeJ(join(d, 'meta.json'), m); },
    pattern: /산출물 '없는파일\.html'이 실재하지 않음/ },
  { id: 'T28', name: '성취기준 파일에 핵심아이디어 누락',
    // references를 변조하므로 러너가 매 테스트 전 성취기준 원본을 재복사한다(위 실행 루프)
    mutate: (d) => {
      const p = join(d, '..', '..', 'references', '성취기준', '화학.json');
      const j = readJ(p); delete j.핵심아이디어; writeJ(p, j);
    },
    pattern: /핵심아이디어가 없거나 비어 있음/ },
  { id: 'T29', name: '성취기준 파일에 내용체계 누락',
    mutate: (d) => {
      const p = join(d, '..', '..', 'references', '성취기준', '화학.json');
      const j = readJ(p); delete j.내용체계; writeJ(p, j);
    },
    pattern: /내용체계가 없음/ },
  { id: 'T30', name: '내용체계 지식·이해에 미정의 영역 주입',
    mutate: (d) => {
      const p = join(d, '..', '..', 'references', '성취기준', '화학.json');
      const j = readJ(p); j.내용체계['지식·이해']['가짜영역'] = ['가짜 요소']; writeJ(p, j);
    },
    pattern: /'가짜영역'이 영역명에 없음/ },
  { id: 'T31', name: 'md 산출물(단원설계.md)에 가짜 성취기준 코드',
    mutate: (d) => writeFileSync(join(d, '단원설계.md'),
      '# 단원설계 — 검증전용테스트\n\n| 차시 | 성취기준 | 주안점 |\n|---|---|---|\n| 1 | [12화학99-99] | 검증용 |\n'),
    pattern: /단원설계\.md: 성취기준 '\[12화학99-99\]'이 실재하지 않음/ },
  { id: 'T32', name: '형성평가.html 성취기준 원문 각색(코드 병기)',
    mutate: (d) => writeFileSync(join(d, '형성평가-1차시.html'),
      `<html><body><h1>형성평가 — 1차시</h1>\n<p><span class="code">${CODE2}</span> ${TEXT2.slice(0, Math.floor(TEXT2.length / 2))}…(각색)</p>\n</body></html>\n`),
    pattern: /형성평가-1차시\.html.*원문 전문이 파일에 없음/ },
  { id: 'T33', name: 'NFD 파일명(macOS 저장 방식) 관찰기록·채점표 — 오탐 없이 통과', control: true,
    mutate: (d) => {
      // macOS는 한글 파일명을 NFD(자모 분해)로 저장할 수 있다 — lint는 NFC 정규화로 매칭해야 함
      for (const [sub, name] of [['수행기록', '관찰기록-1반.csv'], ['산출물', '채점표-1반.csv']]) {
        const p = join(d, sub, name);
        const content = readFileSync(p, 'utf-8');
        unlinkSync(p);
        writeFileSync(join(d, sub, name.normalize('NFD')), content);
      }
    },
    pattern: /✅ 통과 — 오류 0, 경고 0/ },
  { id: 'T34', name: 'NFD 파일명 관찰기록의 내용 위반(실명)도 검출 — 조용한 건너뜀 금지',
    mutate: (d) => {
      const p = join(d, '수행기록', '관찰기록-1반.csv');
      const content = readFileSync(p, 'utf-8') + '김철수,6.9,발표 자료를 정리함,협업\n';
      unlinkSync(p);
      writeFileSync(join(d, '수행기록', '관찰기록-1반.csv'.normalize('NFD')), content);
    },
    pattern: /숫자만 허용/ },
  { id: 'T35', name: '평가기준에 성취기준(별책9)에 없는 코드 주입',
    refMutate: true,  // references/평가기준를 변조 — assessments가 아니라
    mutate: () => {
      const p = join(SANDBOX, 'references', '평가기준', '화학.json');
      const j = readJ(p);
      j.성취기준.push({ 코드: '[12화학99-99]', 영역: '가짜', 성취기준: '지어낸 기준', 평가기준목록: [{ 척도: '5척도', 수준: { A: 'x' } }] });
      writeJ(p, j);
    },
    pattern: /성취기준\(별책9\)에 없음/ },
  { id: 'T36', name: '평가기준 성취기준에 수준 기술이 빔',
    refMutate: true,
    mutate: () => {
      const p = join(SANDBOX, 'references', '평가기준', '화학.json');
      const j = readJ(p);
      j.성취기준[0].평가기준목록 = [{ 척도: '5척도', 수준: {} }];
      writeJ(p, j);
    },
    pattern: /평가기준에 수준 기술 없음/ },
];

// ── 실행 ──
console.log(`=== lint 자가 시험 (샌드박스: ${SANDBOX}) ===`);
const failed = [];
for (const t of tests) {
  rmSync(join(SANDBOX, 'assessments'), { recursive: true, force: true });
  // references를 변조하는 테스트(T25·T28·T35 등)가 다음 테스트를 오염시키지 않도록 매번 원본 재복사
  copyFileSync(join(ROOT, 'references', '교과목록.json'), join(SANDBOX, 'references', '교과목록.json'));
  copyRefDir('성취기준');
  copyRefDir('평가기준');
  writeFixture(DEST);
  t.mutate(DEST);
  const r = spawnSync(process.execPath, [join(SANDBOX, 'scripts', 'lint.mjs')], { encoding: 'utf-8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = t.control ? (t.pattern.test(out) && r.status === 0) : t.pattern.test(out);
  if (!ok) failed.push(t);
  console.log(`${ok ? '✅' : '❌'} ${t.id}  ${t.name}`);
}
rmSync(SANDBOX, { recursive: true, force: true });

if (failed.length) {
  console.error(`\n❌ 실패 ${failed.length}/${tests.length} — lint가 놓치는 위반: ${failed.map((t) => t.id).join(', ')}`);
  process.exit(1);
}
console.log(`\n✅ ${tests.length}/${tests.length} 통과 — lint가 알려진 위반 유형을 모두 검출`);
process.exit(0);
