# A4 인쇄 CSS — 수행평가 산출물 공통 스타일

수행평가 HTML 산출물은 아래 스타일을 `<style>`에 포함해 A4 PDF로 인쇄한다.
**인쇄 방법**: 브라우저에서 인쇄(⌘/Ctrl+P) → 대상 A4 · 여백 기본 · "배경 그래픽" 켜기 → PDF로 저장.

## 공통 CSS (복사해서 사용)
```css
@page { size: A4 portrait; margin: 15mm; }
* { box-sizing: border-box; }
body { font-family: 'Pretendard','맑은 고딕','Malgun Gothic',sans-serif;
       font-size: 10.5pt; color:#111; line-height:1.5; margin:0; }
h1 { font-size: 16pt; margin:0 0 4pt; }
h2 { font-size: 12pt; margin:14pt 0 4pt; border-left:4px solid #2b6; padding-left:6pt; }
.sub { color:#555; font-size:9.5pt; margin-bottom:10pt; }
.meta-badges span { display:inline-block; background:#eef6ef; border:1px solid #cde3d2;
       border-radius:4px; padding:1pt 7pt; margin-right:5pt; font-size:9pt; }
table { width:100%; border-collapse:collapse; margin:8pt 0; }
th,td { border:1px solid #999; padding:5pt 6pt; vertical-align:top; text-align:left; }
th { background:#f0f0f0; font-weight:600; }
.code { font-family:ui-monospace,SFMono-Regular,monospace; white-space:nowrap;
       color:#0a7d33; font-size:9.5pt; }
.todo { background:#fff3cd; color:#8a6d00; font-weight:600; padding:0 4pt; border-radius:3px; }
.foot { margin-top:14pt; font-size:8.5pt; color:#666; border-top:1px solid #ccc; padding-top:6pt; }
.sign { margin-top:10pt; font-size:9pt; }
@media print { .noprint { display:none; } }
```

## 규칙
- 한 산출물은 가능하면 A4 **1~2장**.
- 성취기준 **원문은 표 안에 그대로** 넣는다(수정 금지). 코드는 `.code` 클래스.
- `[확인 필요]`는 `.todo` 클래스로 강조해 교사가 직접 채우도록 한다.
- 하단 `.foot`에 출처(교육부 고시 제2022-33호 [별책 9])와 "본 산출물은 초안이며 교사 검토가 필요함"을 명시.
- 가로 표가 넓으면 `@page`를 `A4 landscape`로 바꾼다.
