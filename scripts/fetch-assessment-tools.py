# KICE 학생평가지원포털(stas.moe.go.kr)에서 고등학교 과학 교과의 평가 도구 3종
# (수행평가 도구 / 서·논술형 평가 도구 / 현장 중심 학생평가 도구) 목록을 수집해
# references/수행평가-도구-KICE.json 카탈로그로 저장한다. (도구 원본 HWP는 포털에서 도구명 검색→다운로드)
# 사용: python scripts/fetch-assessment-tools.py   (표준 라이브러리만 — Mac/Windows 겸용)
# ⚠ 도구 대부분이 2015 개정 기반 — 성취기준 코드가 2022 개정과 다르다. 활동·루브릭 구조만 차용(라벨 `참고(KICE 도구)`).
import datetime
import json
import pathlib
import ssl
import sys
import time
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "references" / "수행평가-도구-KICE.json"
BASE = "https://stas.moe.go.kr/rest"
TASK_TYPES = {
    "ASSMT_EVAL_TASK": "수행평가 도구",
    "DESCRPT_EVAL_TASK": "서·논술형 평가 도구",
    "FLD_CNTR_EVAL_TASK": "현장 중심 학생평가 도구",
}
DELAY = 0.15
_ssl_ctx = None


def get_json(path, params):
    global _ssl_ctx
    url = f"{BASE}{path}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.URLError as e:
        if _ssl_ctx is None and isinstance(getattr(e, "reason", None), ssl.SSLCertVerificationError):
            _ssl_ctx = ssl._create_unverified_context()  # 공개 데이터 읽기 전용 폴백
            return get_json(path, params)
        raise
    time.sleep(DELAY)
    return data


def main():
    tools = []
    for ccd, ccd_nm in TASK_TYPES.items():
        page_no, total = 0, None
        while True:
            d = get_json("/assmt/assmtEvalTask/assmtEvalTaskList", {
                "sAssmtEvalTaskClsCcd": ccd, "sSchlClsCd": "s3", "sCorsCd": "ec1",
                "size": "100", "page": str(page_no),
            })
            total = d.get("totalElements", 0)
            for r in d.get("content", []):
                tools.append({
                    "도구유형": ccd_nm,
                    "도구명": (r.get("assmtEvalTaskNm") or "").strip(),
                    "교육과정": r.get("eduCurclmNm"),
                    "과목": r.get("sbjtNm"),
                    "영역": r.get("corsSbjtClsfcA1Nm"),
                    "성취기준코드": (r.get("acvmtStdCd") or "").strip(),
                    "성취기준": (r.get("acvmtStdNm") or "").strip(),
                    "평가방법": [x.strip() for x in (r.get("corsSbjtClsfcA3Nm") or "").split(",") if x.strip()],
                    "역량": [x.strip() for x in (r.get("corsSbjtClsfcA2Nm") or "").split(",") if x.strip()],
                    "파일형식": (r.get("fileInfo") or "").split(":")[0],
                    "포털seq": r.get("assmtEvalTaskSeq"),
                })
            if (page_no + 1) * 100 >= total:
                break
            page_no += 1
        print(f"{ccd_nm}: {sum(1 for t in tools if t['도구유형'] == ccd_nm)}건 (전체 {total})")
    out = {
        "_메타": {
            "설명": "고등학교 과학 교과 평가 도구 카탈로그 (도구 원본은 포털에서 도구명 검색 후 다운로드)",
            "출처": "KICE 학생평가지원포털 — https://stas.moe.go.kr (교육부·한국교육과정평가원)",
            "수집일": datetime.date.today().isoformat(),
            "주의": "대부분 2015 개정 기반 — 성취기준 코드가 2022 개정과 다름. 활동 아이디어·루브릭 구조만 차용하고 라벨은 참고(KICE 도구).",
        },
        "도구": tools,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"저장: {OUT} (총 {len(tools)}건)")


if __name__ == "__main__":
    main()
