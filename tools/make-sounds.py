#!/usr/bin/env python3
"""Synthesises Flurry's sounds into sounds/*.wav.

Everything is made here from noise and sine waves (no samples, so nothing
to license): three takes of an ambient bed per effect, which the player
overlaps one into the next in a random order (so it never sounds like a
loop), and the short
sounds the scene plays the moment something happens (thunder with each
bolt, a soft thud when a window throws its snow off, fireworks...), each
in a few variants so no two in a row are the same.

    python3 tools/make-sounds.py        # needs numpy and scipy

Fixed seeds: the same files every run.
"""
import os
import wave

import numpy as np
from scipy import signal

SR = 32000
BED_SR = 24000        # the beds: nothing in them above 12 kHz worth the bytes
BED_SECONDS = 14      # each take
BED_TAKES = 3
BED_OVERLAP = 2.5     # s the next take starts before this one ends (lib/sound.js)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sounds")
rng = np.random.default_rng(20261125)


def t_of(sec):
    return np.arange(int(sec * SR)) / SR


def white(sec):
    return rng.standard_normal(int(sec * SR))


def pink(sec):
    # Voss-McCartney-ish by filtering white noise (-3 dB/oct).
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    return signal.lfilter(b, a, white(sec)) * 4


def brown(sec):
    x = np.cumsum(white(sec))
    x = signal.lfilter([1, -1], [1, -0.999], x)  # keep it from wandering off
    return x / (np.abs(x).max() + 1e-9)


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def lp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype="low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype="high", fs=SR, output="sos"), x)


def smooth_noise(sec, rate, lo=0.0, hi=1.0):
    """A slow random envelope between lo and hi, changing about `rate` times a second."""
    n = int(sec * SR)
    k = max(4, int(sec * rate) + 3)
    pts = rng.uniform(lo, hi, k)
    xs = np.linspace(0, n, k)
    return np.interp(np.arange(n), xs, pts)


def env(n, attack, decay, curve=1.0):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(attack, 1e-4)) * np.exp(-np.maximum(0, t - attack) / decay * curve)
    return e


def loopify(x, fade=1.5):
    """Make a seamless loop: the tail is crossfaded into the head."""
    f = int(fade * SR)
    head, body, tail = x[:f], x[f:-f], x[-f:]
    w = np.linspace(0, 1, f)
    w = np.sin(w * np.pi / 2) ** 2
    joined = tail * (1 - w) + head * w
    return np.concatenate([body, joined])


def edges(x, sec=BED_OVERLAP):
    """Fade a take in and out over the overlap, equal-power, so two takes
    laid over each other there keep the level steady."""
    n = int(sec * SR)
    x = x.copy()
    w = np.linspace(0, 1, n)
    x[:n] *= np.sin(w * np.pi / 2)
    x[-n:] *= np.cos(w * np.pi / 2)
    return x


def norm(x, peak=0.8):
    m = np.abs(x).max()
    return x * (peak / m) if m > 0 else x


def fade_out(x, sec=0.05):
    n = min(len(x), int(sec * SR))
    x = x.copy()
    x[-n:] *= np.linspace(1, 0, n)
    return x


def write(name, x, peak=0.8, rms=None):
    x = np.asarray(x, dtype=np.float64)
    if rms is not None:
        # The takes of one bed at one loudness (by their middles, not their fades).
        mid = x[int(BED_OVERLAP * SR):-int(BED_OVERLAP * SR)]
        x = x * (rms / (np.sqrt((mid ** 2).mean()) + 1e-12))
        if np.abs(x).max() > 0.97:
            x = x * (0.97 / np.abs(x).max())
    else:
        x = norm(x, peak)
    data = (np.clip(x, -1, 1) * 32767).astype("<i2")
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def tone(freq, sec, decay, partials=((1, 1.0),), vib=0.0):
    t = t_of(sec)
    y = np.zeros_like(t)
    for mult, amp in partials:
        y += amp * np.sin(2 * np.pi * freq * mult * t + vib * np.sin(2 * np.pi * 5 * t))
    return y * env(len(t), 0.004, decay)


# ------------------------------------------------------------------ beds

def bed_snow(sec=16):
    # A hush of winter wind: low noise that swells and falls, with a faint
    # whistle in the gusts.
    base = bp(pink(sec), 120, 700) * smooth_noise(sec, 0.35, 0.25, 1.0)
    air = bp(pink(sec), 300, 1400) * smooth_noise(sec, 0.25, 0.0, 0.35)
    whistle = bp(white(sec), 900, 1100, 3) * smooth_noise(sec, 0.2, 0.0, 0.25) ** 2 * 2
    return (norm(base) * 0.9 + norm(air) * 0.35 + norm(whistle) * 0.12)


def bed_rain(sec=16):
    # Steady rain: a wash of high noise, the low roar of it hitting the
    # ground, and a patter of single drops close by.
    wash = hp(pink(sec), 900) * smooth_noise(sec, 0.3, 0.8, 1.0)
    roar = lp(pink(sec), 400) * 0.5
    n = int(sec * SR)
    drops = np.zeros(n)
    for _ in range(int(sec * 55)):
        i = rng.integers(0, n - 2000)
        f = rng.uniform(1800, 5200)
        d = tone(f, 0.03, rng.uniform(0.004, 0.012)) * rng.uniform(0.2, 1.0)
        drops[i:i + len(d)] += d
    drops = hp(drops, 1200)
    return (norm(wash) * 0.7 + norm(roar) * 0.45 + norm(drops) * 0.35)


def bed_leaves(sec=16):
    # Autumn wind through dry leaves: breathy wind and crisp rustles that
    # come with the gusts.
    gust = smooth_noise(sec, 0.4, 0.15, 1.0) ** 1.5
    wind = bp(pink(sec), 200, 1200) * gust
    n = int(sec * SR)
    rustle = np.zeros(n)
    for _ in range(int(sec * 160)):
        i = rng.integers(0, n - 800)
        L = int(rng.uniform(0.004, 0.02) * SR)
        b = rng.standard_normal(L) * env(L, 0.0005, rng.uniform(0.002, 0.008)) * rng.uniform(0.1, 1)
        rustle[i:i + L] += b
    rustle = bp(rustle, 2500, 9000) * (0.25 + gust)
    return (norm(wind) * 0.6 + norm(rustle) * 0.5)


def bed_starfall(sec=24):
    # A clear night: a slow, wide pad and now and then a high glint.
    t = t_of(sec)
    chords = [(220.0, 277.18, 329.63), (196.0, 246.94, 293.66), (174.61, 220.0, 261.63), (196.0, 261.63, 329.63)]
    seg = sec / len(chords)
    pad = np.zeros_like(t)
    for k, ch in enumerate(chords):
        w = np.clip(1 - np.abs((t - (k + 0.5) * seg) / (seg * 0.85)), 0, 1) ** 1.2
        # wrap around for a seamless loop
        w += np.clip(1 - np.abs((t - (k + 0.5) * seg + sec) / (seg * 0.85)), 0, 1) ** 1.2
        w += np.clip(1 - np.abs((t - (k + 0.5) * seg - sec) / (seg * 0.85)), 0, 1) ** 1.2
        for f in ch:
            for det in (-0.6, 0.0, 0.7):
                pad += w * np.sin(2 * np.pi * (f + det) * t + rng.uniform(0, 6.28)) / 9
    air = lp(pink(sec), 1500) * 0.04
    glints = np.zeros_like(t)
    for _ in range(int(sec * 0.6)):
        i = rng.integers(0, len(t) - SR * 2)
        f = rng.choice([1318.5, 1567.98, 1760.0, 2093.0, 2637.0])
        g = tone(f, 1.8, 0.6, ((1, 1), (2.01, 0.2))) * rng.uniform(0.15, 0.4)
        glints[i:i + len(g)] += g
    return (pad * 0.9 + air + glints * 0.5)


def bed_sakura(sec=20):
    # A spring breeze with a distant wind chime.
    breeze = bp(pink(sec), 250, 2200) * smooth_noise(sec, 0.3, 0.2, 0.9)
    n = int(sec * SR)
    chime = np.zeros(n)
    notes = [880.0, 987.77, 1174.66, 1318.51, 1479.98, 1760.0]
    for _ in range(int(sec * 0.9)):
        i = rng.integers(0, n - SR * 3)
        f = rng.choice(notes)
        c = tone(f, 2.8, 0.9, ((1, 1), (2.76, 0.3), (5.4, 0.1))) * rng.uniform(0.2, 0.6)
        chime[i:i + len(c)] += c
    return (norm(breeze) * 0.55 + norm(chime) * 0.35)


def bed_fireflies(sec=16):
    # A warm summer night: crickets and a soft hum of air.
    n = int(sec * SR)
    t = t_of(sec)
    crickets = np.zeros(n)
    for voice in range(4):
        f = rng.uniform(4200, 5200)
        rate = rng.uniform(2.2, 3.4)          # chirps per second
        pulses = int(rng.integers(3, 5))
        start = rng.uniform(0, 0.5)
        k = start
        amp = rng.uniform(0.3, 1.0)
        while k < sec - 0.3:
            for p in range(pulses):
                i = int((k + p * 0.018) * SR)
                L = int(0.012 * SR)
                if i + L >= n:
                    break
                crickets[i:i + L] += np.sin(2 * np.pi * f * np.arange(L) / SR) * np.hanning(L) * amp
            k += 1 / rate * rng.uniform(0.9, 1.1)
            if rng.random() < 0.08:
                k += rng.uniform(0.5, 1.5)
    night = bp(pink(sec), 150, 700) * smooth_noise(sec, 0.3, 0.5, 1.0)
    return (norm(crickets) * 0.45 + norm(night) * 0.18)


# ------------------------------------------------------------------ events

def thunder(near, sec):
    n = int(sec * SR)
    t = t_of(sec)
    # The rumble: brown noise shaped by a few rolling swells.
    # (Laptop speakers barely play below 150 Hz, so the rumble keeps a
    # growl up to a few hundred hertz and a grainy rattle above that.)
    low = norm(bp(brown(sec), 35, 150, 2))
    growl = norm(bp(pink(sec), 120, 480 if not near else 650, 2))
    grain = norm(bp(white(sec), 400, 1100)) * smooth_noise(sec, 7, 0.1, 1.0)
    rumble = low * 0.55 + growl * 0.85 + grain * (0.1 if not near else 0.18)
    swells = np.zeros(n)
    for k in range(int(rng.integers(3, 6))):
        c = rng.uniform(0.05, 0.6) * sec
        w = rng.uniform(0.3, 1.2)
        swells += rng.uniform(0.4, 1.0) * np.exp(-((t - c) / w) ** 2)
    shape = env(n, 0.02 if near else 0.25, sec * (0.3 if near else 0.35)) * (0.5 + swells)
    out = norm(rumble * shape)
    if near:
        # The crack: a bright, sharp tearing burst right at the flash.
        L = int(0.35 * SR)
        crack = hp(rng.standard_normal(L), 1200) * env(L, 0.001, 0.06)
        crack += bp(rng.standard_normal(L), 300, 1800) * env(L, 0.002, 0.12) * 0.7
        out[:L] += norm(crack) * 1.1
        # Its echo off the city a moment later.
        d = int(rng.uniform(0.18, 0.3) * SR)
        out[d:d + L] += norm(lp(crack, 2500)) * 0.35
    return fade_out(out, 0.4)


def snow_thud(sec=0.6):
    n = int(sec * SR)
    x = lp(white(sec), rng.uniform(380, 650), 2) * env(n, 0.004, rng.uniform(0.06, 0.12))
    sift = bp(white(sec), 1500, 5000) * env(n, 0.03, 0.18) * 0.25
    return fade_out(norm(x) + norm(sift) * 0.25)


def whoosh(sec=0.45):
    n = int(sec * SR)
    t = t_of(sec)
    x = white(sec)
    f0, f1 = rng.uniform(500, 800), rng.uniform(2000, 3200)
    out = np.zeros(n)
    blocks = 30
    for b in range(blocks):
        i0, i1 = b * n // blocks, (b + 1) * n // blocks
        f = f0 + (f1 - f0) * (b / blocks)
        out[i0:i1] = bp(x, f * 0.7, f * 1.3)[i0:i1]
    return fade_out(out * np.sin(np.pi * np.clip(t / sec, 0, 1)) ** 1.5)


def ice_tinkle(sec=0.9):
    out = np.zeros(int(sec * SR))
    for _ in range(int(rng.integers(3, 6))):
        i = int(rng.uniform(0, 0.25) * SR)
        f = rng.uniform(2600, 5200)
        c = tone(f, sec - 0.26, rng.uniform(0.05, 0.15), ((1, 1), (2.7, 0.4), (4.9, 0.2))) * rng.uniform(0.3, 1)
        out[i:i + len(c)] += c
    return fade_out(out)


def firework_launch(sec=1.2):
    t = t_of(sec)
    f = 900 + 1500 * (t / sec) ** 0.8
    ph = 2 * np.pi * np.cumsum(f) / SR
    whistle = np.sin(ph) * (0.3 + 0.7 * t / sec) * 0.25
    hiss = bp(white(sec), 2500, 7000) * 0.3
    return fade_out((whistle + hiss) * env(len(t), 0.05, sec))


def firework_boom(sec=2.6):
    n = int(sec * SR)
    boom = lp(white(sec), 180, 3) * env(n, 0.003, 0.35)
    body = bp(white(sec), 200, 1200) * env(n, 0.002, 0.08) * 0.6
    crackle = np.zeros(n)
    for _ in range(int(rng.integers(40, 90))):
        i = int(rng.uniform(0.3, sec - 0.2) * SR)
        L = int(0.006 * SR)
        crackle[i:i + L] += hp(rng.standard_normal(L), 2000) * rng.uniform(0.2, 1.0) * np.exp(-(i / SR - 0.3) / 1.2)
    return fade_out(norm(boom) + norm(body) * 0.5 + norm(crackle) * 0.35)


def chime(sec=2.0, f=1760.0):
    return tone(f, sec, 0.55, ((1, 1), (2.0, 0.25), (3.01, 0.1))) + tone(f * 1.5, sec, 0.4) * 0.3


def sleigh_bells(sec=4.0):
    out = np.zeros(int(sec * SR))
    k = 0.0
    while k < sec - 0.4:
        for _ in range(4):
            i = int((k + rng.uniform(0, 0.03)) * SR)
            f = rng.uniform(3200, 4800)
            c = tone(f, 0.35, rng.uniform(0.04, 0.09), ((1, 1), (1.47, 0.6), (2.31, 0.3)))
            out[i:i + len(c)] += c * rng.uniform(0.3, 1)
        k += 0.25
    return loopify(out, 0.4)


# The beds' loudness (RMS of a take's middle), as the single loops had it.
BED_RMS = {"snow": 0.079, "rain": 0.148, "leaves": 0.095, "starfall": 0.126, "sakura": 0.105, "fireflies": 0.077}
BEDS = {"snow": bed_snow, "rain": bed_rain, "leaves": bed_leaves, "starfall": bed_starfall,
        "sakura": bed_sakura, "fireflies": bed_fireflies}


def main():
    global SR
    for old in os.listdir(OUT) if os.path.isdir(OUT) else []:
        if old.startswith("bed-") and old.endswith(".wav"):
            os.remove(os.path.join(OUT, old))
    SR = BED_SR
    for effect, make in BEDS.items():
        for k in range(BED_TAKES):
            write(f"bed-{effect}-{k + 1}", edges(make(BED_SECONDS)), rms=BED_RMS[effect])
    SR = 32000
    for i in range(3):
        write(f"thunder-near-{i + 1}", thunder(True, rng.uniform(4.5, 6.5)), 0.95)
    for i in range(3):
        write(f"thunder-far-{i + 1}", thunder(False, rng.uniform(5.5, 8)), 0.8)
    for i in range(3):
        write(f"snow-thud-{i + 1}", snow_thud(), 0.7)
    for i in range(2):
        write(f"whoosh-{i + 1}", whoosh(), 0.6)
    for i in range(3):
        write(f"ice-{i + 1}", ice_tinkle(), 0.5)
    write("firework-launch", firework_launch(), 0.5)
    for i in range(3):
        write(f"firework-boom-{i + 1}", firework_boom(), 0.85)
    for i, f in enumerate([1567.98, 2093.0, 2349.3]):
        write(f"chime-{i + 1}", chime(f=f), 0.45)
    write("sleigh-bells", sleigh_bells(), 0.5)


if __name__ == "__main__":
    main()
