'use client'

import Image from 'next/image'
import { ThemeToggle } from '@/components/theme-toggle'
import { useState } from 'react'

const STACK_LAYERS = [
  {
    index: '01',
    label: 'Hardware',
    summary: 'ESP32-S3 + LSM6DS3 IMU',
    detail: 'ESP32-S3 running C++ firmware, LSM6DS3 IMU at 104Hz, onboard SD card for local storage, and WiFi for cloud upload. BLE is a control-only interface: start/stop, clock sync, trigger upload. CPU clock scales automatically between recording and upload modes to conserve battery. Housed in a custom 3D-printed enclosure with Garmin quarter-turn mounts, sitting under the seatpost tail light.',
  },
  {
    index: '02',
    label: 'Data Format',
    summary: 'Custom .vtx binary',
    detail: 'A purpose-built binary container optimized for constrained embedded environments. Fixed header carries file metadata; variable-length JSON section stores device and session context; binary records carry the raw sensor data. Designed to minimize per-sample overhead and eliminate ASCII conversion latency on-device. Substantially smaller than equivalent CSV at the same sample rate. TypeScript and Python parsers support both on-device generation and cloud-side analysis.',
  },
  {
    index: '03',
    label: 'Transport',
    summary: 'Direct device-to-storage upload',
    detail: 'On trigger, the device connects to provisioned WiFi, checks which recordings are already in the cloud, and uploads new files directly to object storage with no intermediary server in the data path. WiFi credentials and API keys are provisioned over BLE and stored in non-volatile memory on the device. The upload state machine handles resumable transfers and validates completion server-side.',
  },
  {
    index: '04',
    label: 'Processing',
    summary: 'Multi-pass DSP pipeline',
    detail: 'Serverless background jobs process raw IMU data through a multi-pass signal processing pipeline, deriving metrics like pedaling stability, braking intensity, riding position, and road surface roughness. Processing runs at native sample rate to preserve signal fidelity. FIT files from a paired Garmin head unit are ingested separately and aligned by timestamp, correlating IMU-derived metrics against GPS, power, and cadence data.',
  },
  {
    index: '05',
    label: 'Storage',
    summary: 'PostgreSQL + object storage',
    detail: 'Relational schema holds per-ride aggregate metrics and user data, with row-level security enforced on all tables. Raw time-series sample data lives in object storage as compressed blobs, keeping the database schema flat regardless of recording length. Aggregate metrics are denormalized for fast dashboard queries without joins.',
  },
  {
    index: '06',
    label: 'Platform',
    summary: 'Web dashboard + mobile app',
    detail: 'Next.js web platform for ride analysis, trend tracking, and data upload. Time-series charts render the full sample-level detail from each ride. Duration-weighted trend averages surface meaningful signals across a mixed ride calendar. React Native companion app handles BLE device control, recording management, and FIT file upload from the phone.',
  },
]

const TECH_STACK = [
  { layer: 'Firmware', detail: 'C++ (Arduino/ESP-IDF), ESP32-S3, LSM6DS3 IMU at 104Hz' },
  { layer: 'Data format', detail: 'Custom .vtx binary, TypeScript + Python parsers' },
  { layer: 'Mobile', detail: 'React Native, BLE device control via react-native-ble-plx' },
  { layer: 'Backend', detail: 'Next.js 15 App Router, Inngest serverless jobs, PostgreSQL + RLS' },
  { layer: 'Signal processing', detail: 'Butterworth BPF/HPF, zero-phase filtfilt, windowed RMS, LTTB downsampling' },
  { layer: 'Storage', detail: 'Supabase (S3-compatible), gzipped JSON sample blobs, flat relational schema' },
]

const PIPELINE_PASSES = [
  {
    label: 'Braking pre-pass',
    detail: 'Zero-phase forward-backward Butterworth on accel x/z (5Hz). Pitch from filtered accel; forward-backward EMA baseline at 0.2Hz. Braking = pitch deviation correlated with gyro_y.',
  },
  {
    label: 'Pass 1: per-sample',
    detail: 'BPF gyro x/z and accel_x at 0.3–10Hz (stability). HPF accel_z at 1Hz (roughness). HPF accel_y at 1Hz (position).',
  },
  {
    label: 'Pass 2: windowed RMS',
    detail: 'Stability and roughness: 3s window, 0.5s hop. Braking: 0.75s window, 0.2s hop. Runs at native sample rate; decimating before BPF folds road vibration energy into the cadence band.',
  },
  {
    label: 'Pass 3: output',
    detail: 'Interpolate to 5Hz. Position detection: accel_y amplitude vs. gyro_z in 0.75s windows. FIT-VTX timestamp alignment correlates IMU metrics against GPS, power, cadence, and grade.',
  },
]

function StackDiagram() {
  const [active, setActive] = useState(0)

  const advance = (dir: 1 | -1) => {
    setActive(i => (i + dir + STACK_LAYERS.length) % STACK_LAYERS.length)
  }

  const layer = STACK_LAYERS[active]

  return (
    <section className="py-16 sm:py-20 border-b border-border bg-muted/30">
      <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
        <h2 className="text-2xl sm:text-3xl font-serif font-normal mb-8">System architecture</h2>

        {/* Layer tabs */}
        <div className="flex gap-1 mb-8 flex-wrap">
          {STACK_LAYERS.map((l, i) => (
            <button
              key={l.index}
              onClick={() => setActive(i)}
              className={`px-3 py-1.5 rounded text-xs font-mono transition-colors ${
                i === active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {l.index} {l.label}
            </button>
          ))}
        </div>

        {/* Card + nav side by side so buttons don't move */}
        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <div
              key={active}
              className="animate-fade-in rounded-lg border border-border bg-card p-6 sm:p-8"
            >
              <p className="text-xs font-mono text-muted-foreground mb-1">{layer.index} / 06</p>
              <h3 className="text-xl sm:text-2xl font-serif font-normal text-foreground mb-1">{layer.label}</h3>
              <p className="text-sm font-mono text-primary mb-4">{layer.summary}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{layer.detail}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0 pt-1">
            <button
              onClick={() => advance(-1)}
              className="w-8 h-8 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors flex items-center justify-center text-sm"
            >
              ←
            </button>
            <button
              onClick={() => advance(1)}
              className="w-8 h-8 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors flex items-center justify-center text-sm"
            >
              →
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function About() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Navigation */}
      <header className="border-b border-border bg-background/95 backdrop-blur-sm z-50 sticky top-0">
        <div className="container mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="text-xl sm:text-2xl font-normal tracking-tight">VERTEX</div>
            <div className="flex items-center gap-4">
              <a
                href="/login"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Sign in
              </a>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative h-[80vh] min-h-[500px] flex items-center">
          <div className="absolute inset-0">
            <Image
              src="/hero-cycling.jpg"
              alt="Cyclist cornering on road"
              fill
              priority
              className="object-cover brightness-[0.45]"
              sizes="100vw"
              quality={85}
            />
          </div>
          <div className="container mx-auto px-4 sm:px-6 relative z-10">
            <div className="max-w-2xl">
              <div className="bg-card/95 backdrop-blur-sm rounded-lg p-6 sm:p-8 md:p-10 shadow-2xl">
                <p className="text-xs sm:text-sm bg-primary/10 text-primary px-3 py-2 rounded-md mb-4 border border-primary/20 font-mono inline-block">
                  In Development
                </p>
                <h1 className="text-3xl sm:text-4xl md:text-5xl font-light tracking-tight leading-tight mb-4 text-card-foreground">
                  Understanding the physics we ignore
                </h1>
                <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-6">
                  Standard cycling computers tell you how <em>hard</em> you&apos;re riding (power, heart rate, speed) but not how <em>well</em>. Vertex captures the missing dynamics: cornering forces, braking technique, pedaling stability, and road surface quality, from custom ESP32 firmware through a cloud DSP pipeline.
                </p>
                <div className="flex flex-wrap gap-3">
                  <a
                    href="https://github.com/hawthorne-ben/vertex"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-5 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-md font-medium font-mono text-sm"
                  >
                    View on GitHub
                  </a>
                  <a
                    href="#overview"
                    className="px-5 py-2.5 border border-border bg-card/80 hover:bg-card text-card-foreground transition-colors rounded-md font-medium text-sm"
                  >
                    See the architecture
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What this is */}
        <section id="overview" className="py-16 sm:py-20 border-b border-border">
          <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
            <h2 className="text-2xl sm:text-3xl font-serif font-normal mb-6">What this is</h2>
            <div className="max-w-2xl space-y-4 text-muted-foreground leading-relaxed">
              <p>
                A solo project built across the full stack, from soldering components and designing a custom enclosure to writing the signal processing pipeline that turns raw IMU data into meaningful riding metrics.
              </p>
              <p>
                The interesting engineering problems live at the boundaries: designing a binary format efficient enough for a microcontroller and parseable in the cloud, building a DSP pipeline that separates pedaling dynamics from road vibration, and aligning two independent data streams (IMU and GPS) after the fact.
              </p>
            </div>
          </div>
        </section>

        {/* System diagram */}
        <StackDiagram />

        {/* DSP Pipeline */}
        <section className="py-16 sm:py-20 border-b border-border">
          <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
            <h2 className="text-2xl sm:text-3xl font-serif font-normal mb-2">Signal processing pipeline</h2>
            <p className="text-muted-foreground mb-8 text-sm">Four metric streams, one pass over raw samples at native sample rate.</p>
            <div className="space-y-4">
              {PIPELINE_PASSES.map(({ label, detail }, i) => (
                <div key={label} className="flex gap-4">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-mono flex items-center justify-center mt-0.5">
                    {i + 1}
                  </div>
                  <div>
                    <span className="font-medium text-foreground font-mono text-sm">{label}</span>
                    <p className="text-sm text-muted-foreground leading-relaxed mt-0.5">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 p-4 rounded-lg border border-border bg-muted/40 text-sm text-muted-foreground">
              The IMU analysis implementation is closed source. The pipeline architecture above describes what it does; the implementation and calibration methodology are not public.
            </div>
          </div>
        </section>

        {/* Tech stack */}
        <section className="py-16 sm:py-20 border-b border-border bg-muted/30">
          <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
            <h2 className="text-2xl sm:text-3xl font-serif font-normal mb-8">Stack</h2>
            <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {TECH_STACK.map(({ layer, detail }) => (
                <div key={layer} className="flex gap-4 sm:gap-8 p-4 bg-card">
                  <span className="font-mono text-sm text-primary flex-shrink-0 w-32">{layer}</span>
                  <span className="text-sm text-muted-foreground">{detail}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Engineering log */}
        <section className="py-16 sm:py-20">
          <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
            <h2 className="text-2xl sm:text-3xl font-serif font-normal mb-2">Engineering log</h2>
            <p className="text-muted-foreground mb-8 text-sm">Narrative writeups on the harder problems.</p>
            <a
              href="https://lab.ridevertex.com/p/data-without-context-is-just-high"
              target="_blank"
              rel="noopener noreferrer"
              className="block p-5 rounded-lg border border-border bg-card hover:border-primary/40 transition-colors group"
            >
              <p className="font-mono text-xs text-muted-foreground mb-1">lab.ridevertex.com</p>
              <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">
                Data without context is just high fidelity trivia →
              </h3>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                Hardware limitations of GPS, the necessity of 6-DOF sensor fusion, and solving for high-frequency road vibration aliasing above Nyquist.
              </p>
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="container mx-auto px-4 sm:px-6 py-6">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-secondary">
            <p>© {new Date().getFullYear()} Vertex. Building in the open.</p>
            <div className="flex gap-4">
              <a href="https://github.com/hawthorne-ben/vertex" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors font-mono">GitHub</a>
              <a href="https://lab.ridevertex.com" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors font-mono">Substack</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
