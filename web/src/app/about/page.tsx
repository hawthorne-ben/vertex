'use client'

import Image from 'next/image'
import { ThemeToggle } from '@/components/theme-toggle'

const TECH_STACK = [
  { layer: 'Firmware', detail: 'C++ (Arduino/ESP-IDF), ESP32-S3, LSM6DS3 IMU at 104Hz' },
  { layer: 'Wire format', detail: 'Custom .vtx binary — 64-byte header, 28-byte records, TypeScript + Python parsers' },
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
    label: 'Pass 1 — per-sample',
    detail: 'BPF gyro x/z and accel_x at 0.3–10Hz (stability). HPF accel_z at 1Hz (roughness). HPF accel_y at 1Hz (position).',
  },
  {
    label: 'Pass 2 — windowed RMS',
    detail: 'Stability and roughness: 3s window, 0.5s hop. Braking: 0.75s window, 0.2s hop. Runs at native sample rate — decimating before BPF folds road vibration energy into the cadence band.',
  },
  {
    label: 'Pass 3 — output',
    detail: 'Interpolate to 5Hz. Position detection: accel_y amplitude vs. gyro_z in 0.75s windows. FIT-VTX timestamp alignment correlates IMU metrics against GPS, power, cadence, and grade.',
  },
]

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
                href="https://github.com/hawthorne-ben/vertex"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors font-mono"
              >
                GitHub
              </a>
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
                  Standard cycling computers tell you how <em>hard</em> you&apos;re riding — power, heart rate, speed — but not how <em>well</em>. Vertex captures the missing dynamics: cornering forces, braking technique, pedaling stability, and road surface quality, from custom ESP32 firmware through a cloud DSP pipeline.
                </p>
                <div className="flex flex-wrap gap-3">
                  <a
                    href="https://github.com/hawthorne-ben/vertex"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-5 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-md font-medium font-mono text-sm"
                  >
                    View on GitHub →
                  </a>
                  <a
                    href="https://lab.ridevertex.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-5 py-2.5 border border-border bg-card/80 hover:bg-card text-card-foreground transition-colors rounded-md font-medium text-sm"
                  >
                    Engineering Log
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What this is */}
        <section className="py-16 sm:py-20 border-b border-border">
          <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
            <h2 className="text-2xl sm:text-3xl font-serif font-normal mb-8">What this is</h2>
            <div className="grid sm:grid-cols-2 gap-6">
              {[
                {
                  title: 'Custom embedded hardware',
                  body: 'ESP32-S3 firmware in C++ reads an LSM6DS3 IMU at 104Hz via direct I2C register writes. FIFO continuous mode, SPI SD card storage at 16MHz, BLE as a control-only interface. Battery circuit taps the TP4057 charger output through a Schottky isolation diode.',
                },
                {
                  title: 'Custom binary wire format',
                  body: '.vtx files: 64-byte fixed header, variable JSON metadata, then 28-byte IMURecord structs. The record_format bitmask determines per-record byte width, enabling O(1) seek to any sample index. 78% smaller than equivalent CSV at 104Hz.',
                },
                {
                  title: 'Multi-pass DSP pipeline',
                  body: 'Four metric streams — stability, braking, position, surface roughness — computed in a single pass over raw samples. Butterworth BPF/HPF, zero-phase filtfilt, windowed RMS at native sample rate. Results stored as gzipped JSON blobs in object storage.',
                },
                {
                  title: 'Full-stack cloud platform',
                  body: 'Next.js 15 App Router, Inngest serverless background jobs, PostgreSQL with RLS on all user data. FIT-VTX timestamp alignment correlates IMU metrics against Garmin GPS/power data. 38 API routes, React Native companion app for BLE device control.',
                },
              ].map(({ title, body }) => (
                <div key={title} className="p-5 rounded-lg border border-border bg-card">
                  <h3 className="font-medium text-primary mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* System diagram */}
        <section className="py-16 sm:py-20 border-b border-border bg-muted/30">
          <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
            <h2 className="text-2xl sm:text-3xl font-serif font-normal mb-8">System architecture</h2>
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-0 font-mono text-sm">
              {[
                { label: 'ESP32-S3\nLSM6DS3 @ 104Hz', sub: 'firmware (C++)' },
                null,
                { label: '.vtx binary\nSD card', sub: 'custom format' },
                null,
                { label: 'WiFi upload\nSupabase Storage', sub: 'presigned PUT' },
                null,
                { label: 'Inngest jobs\nDSP pipeline', sub: 'serverless' },
                null,
                { label: 'PostgreSQL\n+ blob storage', sub: 'RLS enforced' },
                null,
                { label: 'Next.js\ndashboard', sub: 'web platform' },
              ].map((node, i) =>
                node === null ? (
                  <div key={i} className="text-muted-foreground px-1 hidden sm:block">→</div>
                ) : (
                  <div key={i} className="flex flex-col items-center text-center p-3 rounded-lg border border-border bg-card min-w-[110px]">
                    <span className="text-foreground whitespace-pre-line leading-snug">{node.label}</span>
                    <span className="text-xs text-muted-foreground mt-1">{node.sub}</span>
                  </div>
                )
              )}
            </div>
          </div>
        </section>

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
