#!/usr/bin/env python
"""C3 bench helper: sync-record census + drift fit for one .vtx file.

Usage: ../venv-analysis/bin/python drift_report.py PATH.vtx
Prints the sync count, RTT distribution, the OLS fit, and the trustworthy
flag with its warnings. Reports what is there; makes no claims about it.
"""
import sys, os, statistics
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'packages', 'vtx-parser', 'python'))

from vtx_parser import decode_vtx, compute_clock_drift
try:
    from vtx_parser import detect_clock_steps
except ImportError:
    detect_clock_steps = None


def main(path):
    v = decode_vtx(open(path, 'rb').read())
    recs = list(getattr(v, 'sync_records', None) or [])
    print(f"file: {os.path.basename(path)}")
    print(f"sync records: {len(recs)}")
    if not recs:
        print("\nZERO sync records. Do not proceed to the long recording.")
        return 1

    # Span, from the device-side t1 of first and last record.
    span_ms = recs[-1].t1_device_ms - recs[0].t1_device_ms
    print(f"span: {span_ms/1000:.1f} s ({span_ms/60000:.1f} min)")
    gaps = [(b.t1_device_ms - a.t1_device_ms) / 1000.0 for a, b in zip(recs, recs[1:])]
    if gaps:
        print(f"inter-record gap s: min {min(gaps):.1f} median {statistics.median(gaps):.1f} max {max(gaps):.1f}")
        missed = sum(1 for g in gaps if g > 90)
        print(f"gaps > 90 s (missed syncs): {missed}")

    rtts = [(r.t4_device_ms - r.t1_device_ms) - (r.t3_phone_unix_ms - r.t2_phone_unix_ms) for r in recs]
    rtts_s = sorted(rtts)
    print(f"\nRTT ms: min {rtts_s[0]} median {statistics.median(rtts_s)} "
          f"p90 {rtts_s[int(0.9*(len(rtts_s)-1))]} max {rtts_s[-1]}")
    print(f"  negative RTT (rejected): {sum(1 for r in rtts if r < 0)}")
    print(f"  over 500 ms cap:         {sum(1 for r in rtts if r > 500)}")
    med = statistics.median([r for r in rtts if r >= 0] or [0])
    print(f"  over 4x median ({4*med:.0f} ms): {sum(1 for r in rtts if r > 4*med)}")

    fit = compute_clock_drift(recs)
    print("\n--- fit ---")
    print(f"ppm: {fit.ppm:.2f}   (positive = device clock runs slow)")
    print(f"drift over span: {fit.ppm * fit.span_ms / 1e6:.1f} ms over {fit.span_ms/60000:.1f} min")
    print(f"offset_at_t0_ms: {fit.offset_at_t0_ms:.1f}  (t0_device_ms {fit.t0_device_ms:.0f})")
    print(f"residual_rms_ms: {fit.residual_rms_ms:.1f}   residual_max_ms: {fit.residual_max_ms:.1f}")
    print(f"used: {len(fit.used)}   rejected: {len(fit.rejected)}")
    for r in fit.rejected:
        print(f"  rejected idx {r.observation.index}: rtt {r.observation.rtt_ms:.0f} ms — {r.reason}")
    print(f"trustworthy: {fit.trustworthy}")
    print("warnings:", list(fit.warnings) if fit.warnings else "none")
    print("suspected_steps:", fit.suspected_steps if fit.suspected_steps else "none")

    # Residual structure: sign runs are the cheap tell for a non-linear
    # (thermal) drift rate. Random residuals flip sign about half the time.
    if len(fit.used) >= 6:
        res = [o.offset_ms - (fit.offset_at_t0_ms + fit.ppm * (o.device_ms - fit.t0_device_ms) / 1e6)
               for o in fit.used]
        flips = sum(1 for a, b in zip(res, res[1:]) if (a >= 0) != (b >= 0))
        print(f"\nresidual sign flips: {flips} of {len(res)-1} "
              f"(random ~{(len(res)-1)/2:.0f}; far below suggests structure)")
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
