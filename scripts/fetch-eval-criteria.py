# KICE 학생평가지원포털(stas.moe.go.kr)에서 2022 개정 고등학교 과학과 19과목의
# 성취기준별 평가기준(5척도 A~E / 3척도 상·중·하)을 수집해 references/평가기준/<과목>.json 으로 저장한다.
# 사용: python scripts/fetch-eval-criteria.py   (표준 라이브러리만 사용 — Mac/Windows 겸용, 의존성 없음)
# 검증: 수집한 성취기준 코드를 references/성취기준/<과목>.json 과 전수 대조해 일치 여부를 출력한다.
#   불일치가 있으면 저장은 하되 경고를 남긴다 — 최종 판단은 교사(편집장).
# 출처 표기: 산출물에서 이 데이터를 인용할 때 라벨은 `원문(KICE 평가기준)`.
import datetime
import json
import pathlib
import re
import ssl
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")  # Windows 콘솔 cp949 대비

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "references" / "평가기준"
ACH_DIR = ROOT / "references" / "성취기준"
BASE = "https://stas.moe.go.kr/rest"
PARAMS = {"sEduCurclmCd": "2022", "sSchlClsCd": "s3", "sGrdGrpCd": "g5", "sCorsCd": "ec1"}
LEVEL_KEYS = {"LVL_5": ["A", "B", "C", "D", "E"], "LVL_3": ["상", "중", "하"]}
DELAY = 0.15  # 요청 간격(초) — 서버 예의


_ssl_ctx = None  # 기본 검증 실패 시에만 무검증 폴백 (공개 데이터 읽기 전용 — 일부 파이썬의 CA 번들이 국내 기관 체인을 미포함)


def get_json(path, params=None):
    global _ssl_ctx
    url = f"{BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.URLError as e:
        if _ssl_ctx is None and isinstance(getattr(e, "reason", None), ssl.SSLCertVerificationError):
            print("주의: 인증서 검증 실패 → 무검증 컨텍스트로 폴백합니다 (읽기 전용 공개 데이터).")
            _ssl_ctx = ssl._create_unverified_context()
            return get_json(path, params)
        raise
    time.sleep(DELAY)
    return data


def clean(html):
    text = re.sub(r"<[^>]+>", "", str(html or ""))
    return re.sub(r"\s+", " ", text).strip()


def fetch_subject(sbjt_cd, sbjt_nm):
    page = get_json("/acvmt/acvmtStd/acvmtStdList", {**PARAMS, "sSbjtCd": sbjt_cd, "size": "200", "page": "0"})
    standards = []
    for row in page.get("content", []):
        dtl = get_json("/acvmt/acvmtStd/acvmtStd", {"sAcvmtStdSeq": row["acvmtStdSeq"]})
        crits = []
        for ev in dtl.get("acvmtStdEvalList") or []:
            ccd = ev.get("evalLvlClsCcd", "")
            keys = LEVEL_KEYS.get(ccd)
            if not keys:  # 미지의 척도 코드 — 지어내지 않고 원본 필드명 그대로 보존
                keys = None
            levels = {}
            for i in range(1, 6):
                cont = clean(ev.get(f"evalLvlCont{i}"))
                if not cont:
                    continue
                levels[keys[i - 1] if keys and i <= len(keys) else f"수준{i}"] = cont
            crits.append({"척도": ev.get("evalLvlClsNm", ""), "평가기준": clean(ev.get("evalStd")), "수준": levels})
        standards.append({
            "코드": clean(dtl.get("acvmtStdCd")),
            "영역": clean(dtl.get("corsSbjtClsfcA1Nm")),
            "성취기준": clean(dtl.get("acvmtStdNm")),
            "해설": clean(dtl.get("acvmtStdExpln")),
            "평가기준목록": crits,
        })
    return standards


def main():
    subjects = get_json("/cmn/clsfc/sbjtList:combo", PARAMS)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    total_mismatch = 0
    for s in subjects:
        name = unicodedata.normalize("NFC", s["name"]).strip()
        fname = name.replace(" ", "") + ".json"
        print(f"수집: {name} ({s['code']}) …", end=" ")
        standards = fetch_subject(s["code"], name)
        out = {
            "과목": name,
            "교육과정": "2022 개정",
            "출처": "KICE 학생평가지원포털 성취기준(평가기준) 검색 — https://stas.moe.go.kr (교육부·한국교육과정평가원)",
            "수집일": datetime.date.today().isoformat(),
            "성취기준": standards,
        }
        (OUT_DIR / fname).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        # 기존 성취기준 데이터와 코드 전수 대조 (별책9 기반 파일이 진실의 원천)
        ach_path = ACH_DIR / fname
        note = "성취기준 파일 없음 — 대조 불가"
        if ach_path.exists():
            ach = json.loads(ach_path.read_text(encoding="utf-8"))
            ach_codes = {c["코드"] for a in ach.get("영역", []) for c in a.get("성취기준", [])}
            got_codes = {st["코드"] for st in standards}
            missing, extra = ach_codes - got_codes, got_codes - ach_codes
            if not missing and not extra:
                note = f"코드 {len(got_codes)}개 전부 일치"
            else:
                note = f"불일치! 별책9에만: {sorted(missing)} / 포털에만: {sorted(extra)}"
                total_mismatch += 1
        no_crit = [st["코드"] for st in standards if not st["평가기준목록"]]
        crit_note = f", 평가기준 없음 {len(no_crit)}건: {no_crit}" if no_crit else ""
        print(f"{len(standards)}개 — {note}{crit_note}")
    print(f"\n완료: {OUT_DIR} (불일치 과목 {total_mismatch}개)")
    return 0 if total_mismatch == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
