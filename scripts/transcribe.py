# 수업 녹음(mp3·m4a·wav 등) → 타임스탬프 녹취록(txt) 자동 전사 (Mac/Windows 겸용)
# 사용: uv run scripts/transcribe.py <음성파일 ...> [옵션]
#   --model    large-v3-turbo(기본)·medium·small — 작을수록 빠르고 부정확
#   --engine   auto(기본)·faster·mlx — auto는 Apple Silicon+기본 모델이면 mlx 가속, 그 외 faster-whisper(CPU)
#   --outdir   출력 폴더 (기본: 음성 파일 옆)
#   --language 언어 코드 (기본 ko)
#   --prompt   전사 힌트 문장 (기본: 화학 수업 용어 힌트, ""로 끄기)
# 준비물: uv 뿐 (Mac: 설치돼 있음 / 학교 PC: winget install astral-sh.uv — 1회).
#   파이썬 3.12와 의존성은 uv가 자동 준비. ffmpeg 불필요(PyAV 내장 디코더).
#   첫 실행은 모델 다운로드(수백 MB~1.6GB)로 오래 걸린다. CPU 전사(학교 PC)는
#   대략 녹음 길이의 절반~한 배가 걸리므로 수업 직후 걸어두는 배치 운영을 권장.
# ⚠ 개인정보: 녹취록에는 학생 실명 호명이 남을 수 있다. 음성 원본과 전사 txt는
#   Google Drive 동기화 폴더 밖(로컬 전용 폴더)에 두고, 패키지에는 비식별 관찰기록 CSV만 넣는다.
# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#     "faster-whisper>=1.1",
#     "mlx-whisper>=0.4; sys_platform == 'darwin' and platform_machine == 'arm64'",
# ]
# ///
import argparse
import datetime
import importlib.util
import pathlib
import platform
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")  # Windows 콘솔 cp949 대비

ROOT = pathlib.Path(__file__).resolve().parent.parent  # 패키지 루트 = Drive 동기화 폴더
MLX_MODELS = {"large-v3-turbo": "mlx-community/whisper-large-v3-turbo"}  # mlx 가속 지원 모델만
DEFAULT_PROMPT = "고등학교 화학 수업 녹음. 몰 농도, 몰랄 농도, 화학 결합, 이온화 에너지, 산화 환원, 전기 분해, 전극, 공유 결합, 옥텟 규칙. 기록, 3번, 관찰한 사실."


def format_ts(sec):
    sec = int(sec)
    h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def pick_engine(requested, model):
    mlx_ready = (platform.system() == "Darwin" and platform.machine() == "arm64"
                 and model in MLX_MODELS and importlib.util.find_spec("mlx_whisper") is not None)
    if requested == "auto":
        return "mlx" if mlx_ready else "faster"
    if requested == "mlx" and not mlx_ready:
        if platform.system() != "Darwin" or platform.machine() != "arm64":
            sys.exit("오류: mlx 엔진은 Apple Silicon Mac 전용입니다. --engine faster 로 실행하세요.")
        sys.exit(f"오류: mlx 가속은 {'·'.join(MLX_MODELS)} 모델만 지원합니다. --engine faster 로 실행하세요.")
    return requested


def transcribe_mlx(audio, model, language, prompt):
    import mlx_whisper
    result = mlx_whisper.transcribe(audio, path_or_hf_repo=MLX_MODELS[model],
                                    language=language, initial_prompt=prompt or None, verbose=False)
    return [(s["start"], s["end"], s["text"].strip()) for s in result["segments"]]


_faster_model = None  # 여러 파일 처리 시 모델 1회 로드


def transcribe_faster(audio, model, language, prompt, duration):
    global _faster_model
    from faster_whisper import WhisperModel
    if _faster_model is None:
        _faster_model = WhisperModel(model, device="cpu", compute_type="int8")
    segments, _info = _faster_model.transcribe(audio, language=language, vad_filter=True,
                                               initial_prompt=prompt or None)
    out, next_mark = [], 300
    for s in segments:  # 제너레이터 — 소비하며 5분 단위 경과 표시 (CPU 전사는 오래 걸림)
        out.append((s.start, s.end, s.text.strip()))
        if s.start >= next_mark:
            print(f"  … {format_ts(s.start)} / {format_ts(duration)} 처리")
            next_mark += 300
    return out


def main():
    ap = argparse.ArgumentParser(description="수업 녹음 → 타임스탬프 녹취록 txt (Mac/Windows 겸용)")
    ap.add_argument("files", nargs="+", help="음성 파일 (mp3·m4a·wav·aiff 등)")
    ap.add_argument("--model", default="large-v3-turbo")
    ap.add_argument("--engine", default="auto", choices=["auto", "faster", "mlx"])
    ap.add_argument("--outdir", default=None)
    ap.add_argument("--language", default="ko")
    ap.add_argument("--prompt", default=DEFAULT_PROMPT)
    args = ap.parse_args()

    from faster_whisper.audio import decode_audio  # 디코더는 엔진 공통 (PyAV — ffmpeg 불필요)

    engine = pick_engine(args.engine, args.model)
    print(f"엔진: {engine} | 모델: {args.model} (첫 실행이면 모델 다운로드에 시간이 걸립니다)")

    for f in args.files:
        src = pathlib.Path(f).expanduser().resolve()
        if not src.exists():
            print(f"건너뜀(파일 없음): {src}")
            continue
        outdir = pathlib.Path(args.outdir).expanduser().resolve() if args.outdir else src.parent
        outdir.mkdir(parents=True, exist_ok=True)
        out = outdir / f"{src.stem}.전사.txt"
        try:  # 전사에는 실명이 남을 수 있다 — 동기화 폴더 안이면 경고
            out.relative_to(ROOT)
            print("주의: 출력 위치가 Google Drive 동기화 폴더 안입니다. 음성·전사는 로컬 전용 폴더를 권장합니다.")
        except ValueError:
            pass

        audio = decode_audio(str(src), sampling_rate=16000)
        duration = len(audio) / 16000
        print(f"전사 시작: {src.name} (길이 {format_ts(duration)})")
        t0 = time.time()
        if engine == "mlx":
            segs = transcribe_mlx(audio, args.model, args.language, args.prompt)
        else:
            segs = transcribe_faster(audio, args.model, args.language, args.prompt, duration)
        elapsed = time.time() - t0

        stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        lines = ["# 녹취록 (자동 전사 초안 — 오인식 가능, 교사 검토 전제. 실명 포함 가능 → 패키지 폴더로 복사 금지)",
                 f"# 원본: {src.name} | 길이: {format_ts(duration)} | 모델: {args.model} ({engine}) | 생성: {stamp}", ""]
        lines += [f"[{format_ts(s)}] {text}" for s, _e, text in segs if text]
        out.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"완료: {out} (세그먼트 {len(segs)}개, {elapsed:.0f}초 소요)")


if __name__ == "__main__":
    main()
