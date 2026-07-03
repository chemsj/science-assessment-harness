# _모음 폴더의 설명+산출물 전체 → 책갈피 달린 단일 A4 PDF (Mac/Windows 겸용)
# 사용: python scripts/combine-pdf.py   (필요: pip install markdown pypdf + Chrome/Edge)
# ※ ITEMS가 화학-물질의구조와성질 모음 기준으로 하드코딩돼 있다 — 다른 모음에 쓰려면 ITEMS만 수정.
#   md/csv/json은 A4 한글 래퍼로 감싸 Chrome 헤드리스로 변환, html은 그대로 변환, pypdf로 병합.
import csv as csvmod
import json
import pathlib
import subprocess
import sys
import tempfile
import time

import markdown
from pypdf import PdfWriter

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parent.parent  # 프로젝트 루트 (스크립트 위치 기준 — 기기 무관)
SRC = ROOT / "assessments" / "_모음-화학-물질의구조와성질"
BUILD = pathlib.Path(tempfile.mkdtemp(prefix="combine-pdf-"))
CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]
CHROME = next((c for c in CHROME_CANDIDATES if pathlib.Path(c).exists()), None)
if not CHROME:
    print("Chrome/Edge를 찾을 수 없습니다."); sys.exit(1)
OUT_NAME = "화학-물질의구조와성질-전체.pdf"

# (병합 순서, 원본 파일, 책갈피 라벨, 배너[md/csv/json 래퍼에만], 가로여부)
ITEMS = [
    ("00", "00_프로토콜-실행-설명.html", "00 프로토콜 실행 설명", None, False),
    ("01a", "01_과제정보-meta.json", "01 과제정보 (meta.json)", "① 해석 · 01_과제정보-meta.json", False),
    ("01b", "01_해석.md", "01 해석", "① 해석 · 01_해석.md", False),
    ("02", "02_단원설계.md", "02 단원설계", "② 수업 설계 · 02_단원설계.md", False),
    ("03", "03_형성평가-6차시.html", "03 형성평가(6차시)", None, False),
    ("04", "04_구상.md", "04 구상", "③ 평가 설계 · 04_구상.md", True),
    ("05", "05_평가계획서.html", "05 평가계획서", None, False),
    ("06a", "06_루브릭.html", "06 루브릭", None, False),
    ("06b", "06_루브릭-기계용.json", "06 루브릭 기계용(json)", "③ 평가 설계 · 06_루브릭-기계용.json", False),
    ("07", "07_활동지.html", "07 활동지", None, False),
    ("08", "08_관찰기록-1반.csv", "08 관찰기록(1반)", "④ 운영 · 08_관찰기록-1반.csv", False),
    ("09", "09_피드백-1반.md", "09 피드백(1반)", "④ 운영 · 09_피드백-1반.md", False),
    ("10", "10_채점표-1반.csv", "10 채점표(1반)", "결과 정리 · 10_채점표-1반.csv", True),
    ("11", "11_과세특-초안-1반.md", "11 과세특 초안(1반)", "결과 정리 · 11_과세특-초안-1반.md", False),
    ("12", "12_회고.md", "12 회고", "회고 · 12_회고.md", False),
]

TPL = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>{title}</title>
<style>
@page {{ size: A4 {orient}; margin: 14mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family:'Pretendard','맑은 고딕','Malgun Gothic',sans-serif; font-size:{fs}; color:#161616; line-height:1.6; margin:0; }}
.banner {{ background:#1f4e46; color:#fff; border-radius:5px; padding:5pt 10pt; font-size:10pt; font-weight:700; margin-bottom:10pt; }}
h1 {{ font-size:15pt; margin:6pt 0 4pt; }} h2 {{ font-size:12.5pt; margin:13pt 0 4pt; border-left:4px solid #2b8; padding-left:7pt; }}
h3 {{ font-size:11pt; margin:10pt 0 3pt; }}
table {{ width:100%; border-collapse:collapse; margin:6pt 0; }}
th,td {{ border:1px solid #999; padding:4pt 5pt; vertical-align:top; text-align:left; }}
th {{ background:#f0f0f0; font-weight:600; }}
blockquote {{ border-left:3px solid #cde3d2; background:#f7faf7; margin:6pt 0; padding:5pt 10pt; color:#333; }}
code {{ font-family:ui-monospace,Consolas,monospace; font-size:0.92em; color:#0a7d33; background:#f4f7f5; padding:0 3px; border-radius:3px; }}
pre {{ background:#f7f8f8; border:1px solid #ddd; border-radius:5px; padding:8pt 10pt; font-size:8.6pt; line-height:1.5; white-space:pre-wrap; word-break:break-all; }}
pre code {{ background:none; padding:0; }}
ul,ol {{ margin:4pt 0 8pt; padding-left:18pt; }} li {{ margin:2pt 0; }}
a {{ color:#0a52a0; text-decoration:none; }} hr {{ border:none; border-top:1px solid #ccc; margin:10pt 0; }}
</style></head><body>
<div class="banner">{banner}</div>
{body}
</body></html>"""


def wrap(banner, body, landscape, small):
    return TPL.format(title=banner, banner=banner, body=body,
                      orient="landscape" if landscape else "portrait",
                      fs="8.6pt" if small else "10pt")


def md_to_html(path, banner, landscape):
    body = markdown.markdown(path.read_text(encoding="utf-8"),
                             extensions=["tables", "sane_lists"])
    return wrap(banner, body, landscape, small=landscape)


def csv_to_html(path, banner, landscape):
    rows = list(csvmod.reader(path.read_text(encoding="utf-8").splitlines()))
    head = "".join(f"<th>{c}</th>" for c in rows[0])
    trs = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows[1:] if r)
    body = f"<table><tr>{head}</tr>{trs}</table>"
    return wrap(banner, body, landscape, small=landscape)


def json_to_html(path, banner):
    obj = json.loads(path.read_text(encoding="utf-8"))
    pretty = json.dumps(obj, ensure_ascii=False, indent=2)
    return wrap(banner, f"<pre><code>{pretty}</code></pre>", False, False)


def to_pdf(html_path, pdf_path):
    uri = pathlib.Path(html_path).resolve().as_uri()
    with tempfile.TemporaryDirectory() as tmp:  # 프로필 잠금 충돌 방지
        proc = subprocess.Popen([
            CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
            f"--user-data-dir={tmp}", "--virtual-time-budget=10000",
            "--no-pdf-header-footer", f"--print-to-pdf={pdf_path}", uri,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        waited = 0
        while proc.poll() is None and waited < 60:  # PDF 생성 후에도 안 끝나면 감시 종료
            time.sleep(2); waited += 2
            if pdf_path.exists() and pdf_path.stat().st_size > 0:
                time.sleep(2); proc.terminate(); break
        if proc.poll() is None:
            proc.kill()
    return pdf_path.exists() and pdf_path.stat().st_size > 0


pdfs = []
for key, fname, label, banner, landscape in ITEMS:
    src = SRC / fname
    if not src.exists():
        print(f"MISSING: {fname}"); sys.exit(1)
    if fname.endswith(".html"):
        html_path = src
    else:
        if fname.endswith(".md"):
            html = md_to_html(src, banner, landscape)
        elif fname.endswith(".csv"):
            html = csv_to_html(src, banner, landscape)
        else:
            html = json_to_html(src, banner)
        html_path = BUILD / f"{key}.html"
        html_path.write_text(html, encoding="utf-8")
    pdf_path = BUILD / f"{key}.pdf"
    ok = to_pdf(html_path, pdf_path)
    print(("OK  " if ok else "FAIL") + f" {fname}")
    if not ok:
        sys.exit(1)
    pdfs.append((label, pdf_path))

writer = PdfWriter()
page_no = 0
for label, p in pdfs:
    n_before = page_no
    writer.append(str(p), import_outline=False)
    page_no = len(writer.pages)
    writer.add_outline_item(label, n_before)
out = SRC / OUT_NAME  # 모음 폴더에 바로 저장 (동기화 대상)
with open(out, "wb") as f:
    writer.write(f)
print(f"MERGED: {out} ({len(writer.pages)} pages)")
