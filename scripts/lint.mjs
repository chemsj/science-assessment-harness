#!/usr/bin/env node
// 화학 수행평가 패키지 — 데이터 무결성·산출물 검증기 (lint)
// 사용법: node scripts/lint.mjs
// 목적(설계서 §3-(3)): "확인하면 되지"를 "확인됨"으로 바꾼다. 성취기준 코드 실재성,
//   과목↔평가방식 일치, 코드 형식/중복, 성취기준 파일의 핵심아이디어·내용체계(별책9 원문) 존재,
//   산출물 성취기준 코드 실재 여부를 기계적으로 판정.
// 단원 프로토콜(단원-프로토콜.md)·평가 프로토콜(평가-프로토콜.md) 검증 범위:
//   [해석·설계] *.md — 성취기준 코드 실재성 (해석.md·단원설계.md·구상.md 등 과제 폴더의 md 전체)
//   [준비] 루브릭 — html/json 쌍 존재, 루브릭.json 성취기준 실재·수준/배점 구조·배점 역전·최고수준 배점 합=만점(만점 필수)
//   [준비] *.html — 성취기준 코드 실재성 / 평가계획서·활동지·형성평가는 코드 병기 시 원문 전문 포함(하드룰 2)
//   [실시] 수행기록/관찰기록-<반>.csv — 4열 양식·번호 비식별(숫자만)·빈 사실 금지·날짜 형식·평가어 경고
//   [결과] 산출물/채점표-<반>.csv — 수준·배점이 루브릭.json에 실재, 근거 없는 점수 금지, 합계 검산,
//          번호 중복 금지, 관찰기록에 있는 학생 누락 경고
//   [결과] 과세특 초안(.md, 산출물/ 하위 포함) — 금지표현·분량

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = join(ROOT, 'references');
const ACH = join(REF, '성취기준');
const ASSESS = join(ROOT, 'assessments');

// 성취기준 코드 2체계: 공통과목 [10통과1-01-01](대시2), 선택과목 [12화학01-01](대시1)
const CODE_RE = /^\[(1[02][가-힣]+\d{2}-\d{2}|10[가-힣]+[12]-\d{2}-\d{2})\]$/;
// 원문 자체의 알려진 오타 — 성취기준 코드로 취급하지 않고 통과시킨다.
const KNOWN_TYPOS = new Set(['[10과탐02-01-03]']);
// 과세특(세부능력 및 특기사항) 초안 검사 기준 — references/과세특-기재요령.md 근거
const FORBIDDEN_WORDS = ['수상', '표창', '감사장', '특허', '실용신안', '토익', '토플', '텝스', '모의고사', '학력평가', '학회', '논문', '출간', '어학연수', '장학금', '인증시험', '백분위'];
// 과목별 세특 상한: 한글 500자 = 1,500Byte (NEIS 산정 — 한글 3Byte·영문/숫자/공백 1Byte)
// 원문: 2026 학교생활기록부 기재요령(고등학교) [참고자료 8] 207~208쪽 (_원문/2026_학생부기재요령_고등학교_교육부.pdf)
// ⚠ 공통과목(통합과학 등)은 1·2 합산 500자 — 과목 쌍 합산은 lint 범위 밖, 과세특연계 스킬·교사가 확인
const PROSE_BYTE_LIMIT = 1500;
// 실시 단계 관찰기록 양식 — references/관찰기록-양식.md 근거 (4열 고정)
const RECORD_HEADER = ['번호', '날짜', '관찰한 사실', '관련 역량'];
// '관찰한 사실'에 금지된 해석·평가어 (관찰기록-양식.md §열 정의·작성 규칙 2 근거)
const EVAL_WORDS = ['우수함', '성실함', '뛰어남', '잘함'];
// 날짜 허용 형식: M.D 또는 YYYY-MM-DD (관찰기록-양식.md §열 정의 근거)
const DATE_RE = /^(\d{1,2}\.\d{1,2}|\d{4}-\d{2}-\d{2})$/;
const PENDING = '[확인 필요]';
// 준비 단계 수행평가 요소(교과서·지도서 추출) — references/평가유형-카탈로그.md §2·§3 근거
const ELEMENT_TYPES = new Set(['실험', '자료해석', '토의·토론', '조사·발표', '글쓰기·읽기', '모형·표현', '프로젝트·융합', '평가자료']);
const ELEMENT_SOURCES = new Set(['교과서', '지도서']);

let errors = 0, warns = 0;
const err = (m) => { console.error('  ✗ ' + m); errors++; };
const warn = (m) => { console.warn('  ! ' + m); warns++; };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));

// CSV 파서 (큰따옴표 필드·이스케이프 "" 지원)
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuote = false;
      } else field += ch;
    } else if (ch === '"') inQuote = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

console.log('=== 화학 수행평가 패키지 lint ===');

// [1] 교과목록.json 자체 검증
console.log('\n[1] references/교과목록.json');
const catalog = readJson(join(REF, '교과목록.json'));
const validEvals = new Set(Object.keys(catalog.평가방식정의));
const validGroups = new Set(catalog.묶음정의);
const subjByCode = new Map(catalog.과목.map((s) => [s.코드, s]));
for (const s of catalog.과목) {
  if (!validGroups.has(s.묶음)) err(`${s.과목명}: 묶음 '${s.묶음}' 미정의`);
  if (!validEvals.has(s.평가방식)) err(`${s.과목명}: 평가방식 '${s.평가방식}' 미정의`);
  // 목록이 가리키는 성취기준 파일이 실재해야 함 (깨진 참조는 이후 모든 코드 검증의 구멍)
  if (s.성취기준파일 && !existsSync(join(REF, s.성취기준파일)))
    err(`${s.과목명}: 성취기준파일 '${s.성취기준파일}' 없음 — 교과목록이 깨진 경로를 참조`);
  if (typeof s.기본학점 !== 'number') err(`${s.과목명}: 기본학점 '${s.기본학점}' — 숫자 필수(평가계획서 분기 근거)`);
}
console.log(`  과목 ${catalog.과목.length}개, 평가방식 ${validEvals.size}종`);

// [2] references/성취기준/*.json 검증 + 교과목록 대조
console.log('\n[2] references/성취기준/*.json');
const codesBySubject = new Map();
const areasBySubject = new Map();
const textsBySubject = new Map(); // 과목코드 → Map(성취기준코드 → 원문) — HTML 원문 인용 검증용
if (existsSync(ACH)) {
  for (const f of readdirSync(ACH).filter((x) => x.endsWith('.json')).sort()) {
    const d = readJson(join(ACH, f));
    const meta = d._메타;
    const codes = d.영역.flatMap((a) => a.성취기준.map((c) => c.코드));
    codesBySubject.set(meta.코드, new Set(codes));
    textsBySubject.set(meta.코드, new Map(d.영역.flatMap((a) => a.성취기준.map((c) => [c.코드, c.내용]))));
    areasBySubject.set(meta.코드, new Set(d.영역.map((a) => a.영역명)));
    const cat = subjByCode.get(meta.코드);
    if (!cat) { err(`${f}: 교과목록에 코드 '${meta.코드}' 없음`); continue; }
    if (cat.평가방식 !== meta.평가방식) err(`${f}: 평가방식 불일치 (목록 ${cat.평가방식} ≠ 파일 ${meta.평가방식})`);
    if (cat.묶음 !== meta.묶음) err(`${f}: 묶음 불일치 (목록 ${cat.묶음} ≠ 파일 ${meta.묶음})`);
    if (cat.성취기준파일 !== `성취기준/${f}`) err(`${f}: 경로 불일치 (목록엔 ${cat.성취기준파일})`);
    const seen = new Set();
    for (const area of d.영역) {
      for (const c of area.성취기준) {
        if (!CODE_RE.test(c.코드)) err(`${f}: 코드 형식 이상 ${c.코드}`);
        if (seen.has(c.코드)) err(`${f}: 코드 중복 ${c.코드}`);
        seen.add(c.코드);
        if (!c.내용 || !c.내용.trim()) err(`${f}: 빈 원문 ${c.코드}`);
      }
    }
    // 핵심 아이디어(별책9 내용 체계 원문) — 개념기반 설계·구상의 근거. 과목 단위 배열
    if (!Array.isArray(d.핵심아이디어) || d.핵심아이디어.length === 0)
      err(`${f}: 핵심아이디어가 없거나 비어 있음 — 별책9 내용 체계 원문(과목 단위)을 배열로`);
    else for (const [i, ki] of d.핵심아이디어.entries())
      if (typeof ki !== 'string' || !ki.trim()) err(`${f}: 핵심아이디어[${i}]가 빈 문자열`);
    // 내용 체계(별책9 원문) — 교육과정해석·단원설계의 근거.
    //   지식·이해는 영역별(영역명과 정확히 일치), 과정·기능·가치·태도는 과목 단위 배열
    const cs = d.내용체계;
    let csCount = '';
    if (!cs || typeof cs !== 'object' || Array.isArray(cs)) {
      err(`${f}: 내용체계가 없음 — 별책9 내용 체계 원문(지식·이해/과정·기능/가치·태도)`);
    } else {
      const areaNames = new Set(d.영역.map((a) => a.영역명));
      const ki2 = cs['지식·이해'];
      let nKnow = 0;
      if (!ki2 || typeof ki2 !== 'object' || Array.isArray(ki2)) {
        err(`${f}: 내용체계.지식·이해가 영역별 객체가 아님`);
      } else {
        for (const [area, items] of Object.entries(ki2)) {
          if (!areaNames.has(area)) err(`${f}: 내용체계.지식·이해의 영역 '${area}'이 영역명에 없음`);
          if (!Array.isArray(items) || items.length === 0 || items.some((x) => typeof x !== 'string' || !x.trim()))
            err(`${f}: 내용체계.지식·이해['${area}'] 요소가 없거나 빈 문자열 포함`);
          else nKnow += items.length;
        }
        for (const a of areaNames) if (!(a in ki2)) err(`${f}: 내용체계.지식·이해에 영역 '${a}' 누락`);
      }
      for (const cat of ['과정·기능', '가치·태도']) {
        const arr = cs[cat];
        if (!Array.isArray(arr) || arr.length === 0) err(`${f}: 내용체계.${cat}가 없거나 비어 있음`);
        else for (const [i, x] of arr.entries())
          if (typeof x !== 'string' || !x.trim()) err(`${f}: 내용체계.${cat}[${i}]가 빈 문자열`);
      }
      csCount = `, 내용체계 ${nKnow}·${(cs['과정·기능'] || []).length}·${(cs['가치·태도'] || []).length}`;
    }
    console.log(`  ✓ ${meta.과목명}: 영역 ${d.영역.length}, 성취기준 ${codes.length}, 핵심아이디어 ${(d.핵심아이디어 || []).length}${csCount}`);
  }
} else {
  warn('성취기준 폴더 없음');
}

// [2b] references/수행평가-요소/*.json 검증 — 구상(브레인스토밍)의 근거 데이터
const ELEM_DIR = join(REF, '수행평가-요소');
if (existsSync(ELEM_DIR)) {
  console.log('\n[2b] references/수행평가-요소/*.json');
  for (const f of readdirSync(ELEM_DIR).filter((x) => x.endsWith('.json')).sort()) {
    const tag = `수행평가-요소/${f}`;
    let d;
    try { d = readJson(join(ELEM_DIR, f)); } catch (e) { err(`${tag}: JSON 파싱 실패 — ${e.message}`); continue; }
    const meta = d._메타 || {};
    if (!meta.과목코드 || !subjByCode.has(meta.과목코드)) { err(`${tag}: _메타.과목코드 '${meta.과목코드}'이 교과목록에 없음`); continue; }
    if (!meta.출판사) err(`${tag}: _메타.출판사 없음`);
    if (!Array.isArray(meta.원본) || meta.원본.length === 0) err(`${tag}: _메타.원본 없음`);
    const areas = areasBySubject.get(meta.과목코드);
    const typeCount = new Map();
    (d.요소 || []).forEach((el, i) => {
      const at = `${tag} 요소[${i}]`;
      if (!el.이름 || !el.이름.trim()) err(`${at}: 이름 없음`);
      if (!ELEMENT_TYPES.has(el.유형)) err(`${at}: 유형 '${el.유형}' — 카탈로그 8종만 허용`);
      if (el.영역 !== PENDING && areas && !areas.has(el.영역)) err(`${at}: 영역 '${el.영역}'이 ${meta.과목코드} 영역명에 없음`);
      if (!ELEMENT_SOURCES.has(el.출처)) err(`${at}: 출처 '${el.출처}' — 교과서/지도서만 허용`);
      if (!Number.isInteger(el.쪽)) err(`${at}: 쪽 '${el.쪽}' — 정수 필수 (원문 대조 통로)`);
      typeCount.set(el.유형, (typeCount.get(el.유형) || 0) + 1);
    });
    if (!d.요소 || d.요소.length === 0) warn(`${tag}: 요소 0개`);
    const dist = [...typeCount.entries()].map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`  ✓ ${meta.출판사 || f}: 요소 ${(d.요소 || []).length}개 (${dist})`);
  }
}

// [2c] references/평가기준/*.json 검증 — KICE 학생평가지원포털 성취기준별 평가기준(A~E/상·중·하)
//   루브릭 수준 기술의 `원문(KICE)` 근거. 코드는 성취기준 파일(별책9)과 전수 일치해야 함
const EVAL_DIR = join(REF, '평가기준');
if (existsSync(EVAL_DIR)) {
  console.log('\n[2c] references/평가기준/*.json');
  for (const f of readdirSync(EVAL_DIR).filter((x) => x.endsWith('.json')).sort()) {
    const tag = `평가기준/${f}`;
    let d;
    try { d = readJson(join(EVAL_DIR, f)); } catch (e) { err(`${tag}: JSON 파싱 실패 — ${e.message}`); continue; }
    if (!d.출처 || !/KICE|평가원|stas/i.test(d.출처)) warn(`${tag}: 출처에 KICE 표기 없음 — 근거 라벨 확인`);
    // 같은 파일명의 성취기준(별책9)과 코드 전수 대조 — 평가기준은 성취기준의 파생이므로 정확히 일치해야 함
    const achCodes = existsSync(join(ACH, f))
      ? new Set(readJson(join(ACH, f)).영역.flatMap((a) => a.성취기준.map((c) => c.코드)))
      : null;
    if (!achCodes) warn(`${tag}: 대응 성취기준 파일 없음 — 코드 대조 불가`);
    const seen = new Set();
    let noCrit = 0;
    for (const st of d.성취기준 || []) {
      if (!CODE_RE.test(st.코드)) { err(`${tag}: 코드 형식 이상 '${st.코드}'`); continue; }
      if (seen.has(st.코드)) err(`${tag}: 코드 중복 ${st.코드}`);
      seen.add(st.코드);
      if (achCodes && !achCodes.has(st.코드)) err(`${tag}: 코드 '${st.코드}'이 성취기준(별책9)에 없음 — 포털 수집 오류 또는 성취기준 누락`);
      if (!Array.isArray(st.평가기준목록) || st.평가기준목록.length === 0) { noCrit++; continue; }
      for (const c of st.평가기준목록)
        if (!c.수준 || Object.keys(c.수준).length === 0) err(`${tag}: ${st.코드} 평가기준에 수준 기술 없음`);
    }
    if (achCodes) for (const c of achCodes) if (!seen.has(c)) warn(`${tag}: 성취기준 ${c}의 평가기준이 없음`);
    if (noCrit) warn(`${tag}: 평가기준 비어 있는 성취기준 ${noCrit}건 (포털 미제공 — 지어내지 않음)`);
    console.log(`  ✓ ${f.replace('.json', '')}: 성취기준 ${(d.성취기준 || []).length}개${achCodes ? ', 코드 대조 ✓' : ''}`);
  }
}

// [준비] 루브릭.json 검증 — 채점의 유일한 근거이므로 구조·배점을 기계 판정
function lintRubric(dirName, rubricPath, m, subjCodes) {
  const r = readJson(rubricPath);
  const tag = `${dirName}/루브릭.json`;
  if (r.과목코드 !== m.과목코드) err(`${tag}: 과목코드 '${r.과목코드}' ≠ meta.json '${m.과목코드}'`);
  if (!Array.isArray(r.수준명) || r.수준명.length < 2) err(`${tag}: 수준명이 2개 미만`);
  if (!Array.isArray(r.평가요소) || r.평가요소.length === 0) { err(`${tag}: 평가요소 없음`); return null; }
  const abbrs = new Set();
  let topSum = 0;
  for (const el of r.평가요소) {
    if (!el.약칭 || !el.약칭.trim()) err(`${tag}: '${el.요소}' 약칭 없음`);
    if (abbrs.has(el.약칭)) err(`${tag}: 약칭 중복 '${el.약칭}'`);
    abbrs.add(el.약칭);
    if (el.성취기준코드 && !KNOWN_TYPOS.has(el.성취기준코드)) {
      if (subjCodes && !subjCodes.has(el.성취기준코드)) err(`${tag}: 성취기준 '${el.성취기준코드}'이 ${m.과목코드}에 실재하지 않음`);
    }
    for (const lv of r.수준명) if (!(el.수준 && lv in el.수준)) err(`${tag}: '${el.약칭}'에 수준 '${lv}' 기술 없음`);
    for (const [lv, v] of Object.entries(el.수준 || {})) {
      if (!r.수준명.includes(lv)) err(`${tag}: '${el.약칭}'의 수준 '${lv}'이 수준명에 미정의`);
      if (typeof v.배점 !== 'number') err(`${tag}: '${el.약칭}'/'${lv}' 배점이 숫자가 아님`);
      if (!v.기술 || !v.기술.trim()) err(`${tag}: '${el.약칭}'/'${lv}' 빈 기술`);
    }
    // 수준명은 높은→낮은 순(우수/보통/미흡 등) — 배점이 역전되면 채점 전체가 오염되므로 오류
    const pts = r.수준명.map((lv) => el.수준?.[lv]?.배점).filter((v) => typeof v === 'number');
    for (let i = 1; i < pts.length; i++)
      if (pts[i] > pts[i - 1]) { err(`${tag}: '${el.약칭}' 배점 역전 — 수준명 순서(높은→낮은)대로 배점이 감소해야 함`); break; }
    topSum += Math.max(0, ...Object.values(el.수준 || {}).map((v) => (typeof v.배점 === 'number' ? v.배점 : 0)));
  }
  if (typeof r.만점 !== 'number') err(`${tag}: 만점이 없거나 숫자가 아님 — 배점 합 검산 불가`);
  else if (topSum !== r.만점) err(`${tag}: 최고 수준 배점 합 ${topSum} ≠ 만점 ${r.만점}`);
  return r;
}

// [준비] 루브릭.html ↔ 루브릭.json 내용 일치 — 학생·교사가 보는 기준(html)과 채점 근거(json)가
//   다르면 채점 전체가 오염된다 (루브릭 스킬 규칙: 배점·기술 완전 일치)
function lintRubricPairContent(dirName, base, rubric) {
  const htmlPath = join(base, '루브릭.html');
  if (!rubric || !existsSync(htmlPath)) return;
  const compact = readFileSync(htmlPath, 'utf-8').replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  for (const el of rubric.평가요소 || []) {
    for (const [lv, v] of Object.entries(el.수준 || {})) {
      if (v.기술 && !compact.includes(v.기술.replace(/\s+/g, '')))
        err(`${dirName}/루브릭.html: '${el.약칭}'/'${lv}' 기술이 루브릭.json과 다름 — 쌍은 완전 일치해야 함(루브릭 스킬 규칙)`);
      if (typeof v.배점 === 'number' && !compact.includes(`${v.배점}점`))
        warn(`${dirName}/루브릭.html: '${el.약칭}'/'${lv}' 배점 ${v.배점}점 표기가 보이지 않음 — 쌍 일치 확인`);
    }
  }
}

// [실시] 수행기록/관찰기록-<반>.csv 검증 — 양식 4열·번호 비식별·빈 사실 금지
function lintRecords(dirName, recDir) {
  const byClass = new Map(); // 반 → Set(번호)
  for (const f of readdirSync(recDir).filter((x) => x.endsWith('.csv')).sort()) {
    const fn = f.normalize('NFC'); // macOS는 파일명을 NFD로 저장 — 매칭은 NFC, 파일 접근은 원본
    const tag = `${dirName}/수행기록/${fn}`;
    const mClass = fn.match(/^관찰기록-(.+)\.csv$/);
    if (!mClass) { warn(`${tag}: 파일명이 '관찰기록-<반>.csv' 형식이 아님`); continue; }
    const rows = parseCsv(readFileSync(join(recDir, f), 'utf-8'));
    if (!rows.length) { err(`${tag}: 빈 파일`); continue; }
    const [header, ...body] = rows;
    if (header.join(',') !== RECORD_HEADER.join(','))
      err(`${tag}: 헤더 '${header.join(',')}'이 양식(${RECORD_HEADER.join(',')})과 다름 — references/관찰기록-양식.md`);
    const nums = new Set();
    body.forEach((row, i) => {
      const line = i + 2;
      const [no, date, fact] = row;
      if (row.length !== RECORD_HEADER.length) err(`${tag}:${line} 열 수 ${row.length} ≠ ${RECORD_HEADER.length}`);
      if ((no || '').trim() === PENDING) warn(`${tag}:${line} 번호 ${PENDING} — 교사 확인 후 채우기`);
      else if (!/^\d+$/.test((no || '').trim())) err(`${tag}:${line} 번호 '${no}' — 숫자만 허용(비식별 원칙)`);
      else nums.add(no.trim());
      const dt = (date || '').trim();
      if (dt !== PENDING && !DATE_RE.test(dt)) warn(`${tag}:${line} 날짜 '${date}' — 'M.D' 또는 'YYYY-MM-DD' 형식(관찰기록-양식.md)`);
      if (!fact || !fact.trim()) err(`${tag}:${line} '관찰한 사실'이 비어 있음`);
      else for (const w of EVAL_WORDS) if (fact.includes(w)) warn(`${tag}:${line} '관찰한 사실'에 평가어 '${w}' — 행동·발화 등 사실만 기록(해석·평가는 결과 단계에서)`);
    });
    byClass.set(mClass[1], nums);
    console.log(`  ✓ ${tag}: ${body.length}행, 학생 ${nums.size}명`);
  }
  return byClass;
}

// [결과] 산출물/채점표-<반>.csv 검증 — 수준·배점 실재, 근거 없는 점수 금지, 합계 검산
function lintScoresheet(dirName, path, fname, rubric, recordsByClass) {
  const fn = fname.normalize('NFC'); // 매칭·표시는 NFC (macOS NFD 파일명 대비)
  const tag = `${dirName}/산출물/${fn}`;
  if (!rubric) { err(`${tag}: 루브릭.json이 없어 채점표 검증 불가 (채점 근거 부재)`); return; }
  const cls = (fn.match(/^채점표-(.+)\.csv$/) || [])[1];
  const recSet = cls ? recordsByClass.get(cls) : undefined;
  if (cls && !recSet) warn(`${tag}: 대응하는 수행기록/관찰기록-${cls}.csv 없음 (근거 연결 확인)`);
  const rows = parseCsv(readFileSync(path, 'utf-8'));
  if (!rows.length) { err(`${tag}: 빈 파일`); return; }
  const [header, ...body] = rows;
  const expected = ['번호', ...rubric.평가요소.flatMap((e) => [`${e.약칭}_수준`, `${e.약칭}_점수`, `${e.약칭}_근거`]), '합계', '비고'];
  if (header.join(',') !== expected.join(',')) {
    err(`${tag}: 헤더가 루브릭.json 약칭 기준(${expected.join(',')})과 다름`);
    return;
  }
  let pendingRows = 0;
  const seenNos = new Set();
  body.forEach((row, i) => {
    const line = i + 2;
    const no = (row[0] || '').trim();
    if (!/^\d+$/.test(no)) err(`${tag}:${line} 번호 '${row[0]}' — 숫자만 허용(비식별 원칙)`);
    else {
      if (seenNos.has(no)) err(`${tag}:${line} 번호 ${no} 중복 행 — 한 학생당 한 행`);
      seenNos.add(no);
      if (recSet && !recSet.has(no)) warn(`${tag}:${line} 번호 ${no}: 관찰기록-${cls}.csv에 기록 없음`);
    }
    let sum = 0, pending = false;
    rubric.평가요소.forEach((el, k) => {
      const lv = (row[1 + k * 3] || '').trim();
      const pt = (row[2 + k * 3] || '').trim();
      const ev = (row[3 + k * 3] || '').trim();
      if (lv === PENDING) { pending = true; return; }
      if (!(el.수준 && lv in el.수준)) { err(`${tag}:${line} '${el.약칭}' 수준 '${lv}'이 루브릭.json에 없음`); pending = true; return; }
      const expectPt = el.수준[lv].배점;
      if (Number(pt) !== expectPt) err(`${tag}:${line} '${el.약칭}' 점수 ${pt} ≠ 루브릭 배점 ${expectPt} (수준 '${lv}')`);
      if (!ev || ev === PENDING) err(`${tag}:${line} '${el.약칭}' 근거 없음 — 근거 없는 점수 금지`);
      sum += expectPt;
    });
    const total = (row[1 + rubric.평가요소.length * 3] || '').trim();
    if (pending) {
      pendingRows++;
      if (total !== PENDING) err(`${tag}:${line} 미채점 요소가 있는데 합계가 '${total}' (${PENDING}이어야 함)`);
    } else if (Number(total) !== sum) err(`${tag}:${line} 합계 ${total} ≠ 검산 ${sum}`);
  });
  if (recSet) for (const n of [...recSet].sort((a, b) => a - b))
    if (!seenNos.has(n)) warn(`${tag}: 관찰기록-${cls}.csv에 있는 번호 ${n}이 채점표에 없음 — 채점 누락 확인`);
  console.log(`  ✓ ${tag}: ${body.length}명 (교사 확인 대기 ${pendingRows}명)`);
}

// [준비] HTML 산출물의 성취기준 인용 검증 — 하드룰 2: 코드는 원문과 함께 그대로 인용, 요약·각색 금지
//   모든 .html: 인용된 코드가 해당 과목에 실재해야 함
//   평가계획서·활동지·형성평가-<차시>: 코드를 병기했으면 같은 파일 안에 해당 원문 전문이 있어야 함 (루브릭 수준 기술은 예외)
const HTML_QUOTE_FILES = new Set(['평가계획서.html', '활동지.html']);
const QUOTE_REQUIRED_RE = /^형성평가-.+\.html$/;
const HTML_CODE_RE = /\[\d{2}[가-힣]+\d*(?:-\d{2}){1,2}\]/g;
function lintHtmlCitations(dirName, base, subjCodes, subjTexts) {
  for (const f of readdirSync(base).filter((x) => x.endsWith('.html'))) {
    const fn = f.normalize('NFC'); // 파일명 판정은 NFC (macOS NFD 대비)
    const text = readFileSync(join(base, f), 'utf-8').replace(/<[^>]*>/g, '');
    const compact = text.replace(/\s+/g, '');
    for (const code of new Set(text.match(HTML_CODE_RE) || [])) {
      if (KNOWN_TYPOS.has(code)) continue;
      if (subjCodes && !subjCodes.has(code)) { err(`${dirName}/${fn}: 성취기준 '${code}'이 실재하지 않음`); continue; }
      if ((HTML_QUOTE_FILES.has(fn) || QUOTE_REQUIRED_RE.test(fn)) && subjTexts) {
        const orig = subjTexts.get(code);
        if (orig && !compact.includes(orig.replace(/\s+/g, '')))
          err(`${dirName}/${fn}: '${code}'를 인용했으나 원문 전문이 파일에 없음 — 요약·각색·재작성 금지(하드룰 2)`);
      }
    }
  }
}

// [해석·설계 등] md 산출물의 성취기준 코드 실재성 — 해석.md·단원설계.md·구상.md·회고.md 등
//   (md는 표·인용 형식이 자유로우므로 원문 전문 포함까지는 요구하지 않고 코드 실재성만 검사)
function lintMdCitations(dirName, base, subjCodes) {
  const files = readdirSync(base).filter((x) => x.endsWith('.md')).map((f) => [f, join(base, f)]);
  const outDir = join(base, '산출물');
  if (existsSync(outDir))
    for (const f of readdirSync(outDir).filter((x) => x.endsWith('.md'))) files.push([`산출물/${f}`, join(outDir, f)]);
  for (const [rel, p] of files) {
    const text = readFileSync(p, 'utf-8');
    for (const code of new Set(text.match(HTML_CODE_RE) || [])) {
      if (KNOWN_TYPOS.has(code)) continue;
      if (subjCodes && !subjCodes.has(code)) err(`${dirName}/${rel}: 성취기준 '${code}'이 실재하지 않음`);
    }
  }
}

// [결과] 과세특 초안 검사 — 금지 표현·분량 (과제 폴더 최상위 + 산출물/ 하위)
function lintSetuk(dirName, base) {
  const candidates = [];
  for (const f of readdirSync(base).filter((f) => /세특/.test(f.normalize('NFC')) && f.endsWith('.md'))) candidates.push([f.normalize('NFC'), join(base, f)]);
  const outDir = join(base, '산출물');
  if (existsSync(outDir))
    for (const f of readdirSync(outDir).filter((f) => /세특/.test(f.normalize('NFC')) && f.endsWith('.md'))) candidates.push([`산출물/${f.normalize('NFC')}`, join(outDir, f)]);
  for (const [rel, p] of candidates) {
    const text = readFileSync(p, 'utf-8');
    const sections = text.split(/^##\s+/m).slice(1);
    const units = sections.length
      ? sections.map((s) => ({ title: s.split('\n')[0].trim(), body: s.split('\n').slice(1).join('') }))
      : [{ title: rel, body: text }];
    for (const u of units) {
      const bytes = [...u.body].reduce((a, ch) => a + (ch.codePointAt(0) <= 0x7f ? 1 : 3), 0);
      if (bytes > PROSE_BYTE_LIMIT)
        warn(`${dirName}/${rel} [${u.title}]: ${bytes}Byte > ${PROSE_BYTE_LIMIT}Byte(한글 500자 — 기재요령 [참고자료 8], 학교 지침 우선)`);
    }
    for (const w of FORBIDDEN_WORDS) if (text.includes(w)) err(`${dirName}/${rel}: 금지 표현 '${w}' 포함 (과세특-기재요령.md)`);
  }
}

// [3] assessments/* 검증 — meta 정합성 + 프로토콜 산출물(루브릭.json·관찰기록·채점표·과세특)
console.log('\n[3] assessments/*');
if (!existsSync(ASSESS)) {
  console.log('  (assessments 폴더 없음 — 산출물 검증 건너뜀)');
} else {
  const dirs = readdirSync(ASSESS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'));
  if (dirs.length === 0) console.log('  (산출물 없음)');
  for (const dir of dirs) {
    const base = join(ASSESS, dir.name);
    const metaPath = join(base, 'meta.json');
    if (!existsSync(metaPath)) { warn(`${dir.name}: meta.json 없음`); continue; }
    const m = readJson(metaPath);
    const cat = subjByCode.get(m.과목코드);
    if (!cat) { err(`${dir.name}: 과목코드 '${m.과목코드}'이 교과목록에 없음`); continue; }
    if (!m.평가방식) warn(`${dir.name}: meta.json에 평가방식 없음 — 교과목록 기준 '${cat.평가방식}' 명시 권장`);
    else if (m.평가방식 !== cat.평가방식)
      err(`${dir.name}: 평가방식 '${m.평가방식}'이 과목(${cat.평가방식})과 불일치`);
    if (!m.묶음) warn(`${dir.name}: meta.json에 묶음 없음 — 교과목록 기준 '${cat.묶음}' 명시 권장`);
    else if (m.묶음 !== cat.묶음)
      err(`${dir.name}: 묶음 '${m.묶음}'이 과목(${cat.묶음})과 불일치`);
    const subjCodes = codesBySubject.get(m.과목코드);
    if (!Array.isArray(m.성취기준코드) || m.성취기준코드.length === 0)
      warn(`${dir.name}: meta.json에 성취기준코드가 없거나 비어 있음 — 평가의 성취기준 근거 연결 확인`);
    for (const code of m.성취기준코드 || []) {
      if (KNOWN_TYPOS.has(code)) continue;
      if (!subjCodes) { err(`${dir.name}: '${m.과목코드}' 성취기준 파일이 없어 코드 검증 불가`); break; }
      if (!subjCodes.has(code)) err(`${dir.name}: 성취기준 '${code}'이 ${m.과목코드}에 실재하지 않음`);
    }
    // [준비] 루브릭 — 사람용 .html과 기계용 .json은 쌍(프로토콜 단계 1 하드룰)
    const rubricPath = join(base, '루브릭.json');
    const rubricHtml = existsSync(join(base, '루브릭.html'));
    if (rubricHtml && !existsSync(rubricPath))
      err(`${dir.name}: 루브릭.html은 있으나 루브릭.json 없음 — 기계용 쌍 필수(채점·lint의 유일한 근거)`);
    else if (!rubricHtml && existsSync(rubricPath))
      warn(`${dir.name}: 루브릭.json은 있으나 루브릭.html 없음 — 사람용(교사 검토·학생 공지) 쌍 권장`);
    const rubric = existsSync(rubricPath) ? lintRubric(dir.name, rubricPath, m, subjCodes) : null;
    lintRubricPairContent(dir.name, base, rubric);
    // meta.json 산출물 목록의 실재 — 목록만 있고 파일이 없으면 준비 미완 또는 목록 미갱신
    for (const rel of m.산출물 || [])
      if (!existsSync(join(base, rel))) warn(`${dir.name}: meta.json 산출물 '${rel}'이 실재하지 않음 — 파일 생성 또는 목록 갱신`);
    // [실시] 수행기록
    const recDir = join(base, '수행기록');
    const recordsByClass = existsSync(recDir) ? lintRecords(dir.name, recDir) : new Map();
    // [결과] 채점표
    const outDir = join(base, '산출물');
    if (existsSync(outDir))
      for (const f of readdirSync(outDir).filter((f) => /^채점표-.*\.csv$/.test(f.normalize('NFC'))).sort())
        lintScoresheet(dir.name, join(outDir, f), f, rubric, recordsByClass);
    // [준비] HTML 성취기준 인용
    lintHtmlCitations(dir.name, base, subjCodes, textsBySubject.get(m.과목코드));
    // [해석·설계 등] md 성취기준 코드 실재성
    lintMdCitations(dir.name, base, subjCodes);
    // [결과] 과세특 초안
    lintSetuk(dir.name, base);
    console.log(`  ✓ ${dir.name}: 과목 ${m.과목코드}, 성취기준 ${(m.성취기준코드 || []).length}개 참조${rubric ? ', 루브릭.json ✓' : ''}`);
  }
}

console.log(`\n${errors === 0 ? '✅ 통과' : '❌ 실패'} — 오류 ${errors}, 경고 ${warns}`);
process.exit(errors === 0 ? 0 : 1);
