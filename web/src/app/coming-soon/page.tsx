'use client'

import Image from 'next/image'
import { ThemeToggle } from '@/components/theme-toggle'

export default function ComingSoon() {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Navigation */}
      <header className="border-b border-border bg-background/95 backdrop-blur-sm z-50 flex-shrink-0">
        <div className="container mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="text-xl sm:text-2xl font-normal tracking-tight">
              VERTEX
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        {/* Hero Section */}
        <section className="absolute inset-0 flex items-center">
          {/* Background Image */}
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

          {/* Content Overlay */}
          <div className="container mx-auto px-4 sm:px-6 relative z-10 w-full">
            <div className="max-w-2xl">
              <div className="bg-card/95 backdrop-blur-sm rounded-lg p-6 sm:p-8 md:p-10 lg:p-12 shadow-2xl">
                <p className="text-xs sm:text-sm bg-primary/10 text-primary px-3 py-2 rounded-md mb-4 sm:mb-6 border border-primary/20 font-mono inline-block">
                  In Development
                </p>

                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-light tracking-tight leading-tight mb-4 sm:mb-6 text-card-foreground">
                  Understanding the physics we ignore
                </h1>

                <div className="space-y-4 sm:space-y-5 text-base sm:text-lg text-muted-foreground leading-relaxed mb-6 sm:mb-8">
                  <p>
                    Standard cycling computers tell you how <em>hard</em> you&apos;re riding—power, heart rate, speed—but not how <em>well</em>.
                  </p>

                  <p>
                    I&apos;m building Vertex to understand this missing physics: descending angles and cornering forces, traction limits, braking technique, and the real-world dynamics that make you faster.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                  <a
                    href="https://lab.ridevertex.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-6 py-3 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-md text-center font-medium font-mono"
                  >
                    Follow the Build →
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="absolute bottom-0 left-0 right-0 border-t border-border bg-card/95 backdrop-blur-sm z-10">
            <div className="container mx-auto px-4 sm:px-6 py-4">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-secondary">
                <p>© {new Date().getFullYear()} Vertex. Building in the open.</p>
                <a
                  href="https://lab.ridevertex.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary transition-colors font-mono"
                >
                  lab.ridevertex.com
                </a>
              </div>
            </div>
          </footer>
        </section>
      </main>
    </div>
  )
}
