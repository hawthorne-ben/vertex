'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import Image from 'next/image'
import { ThemeToggle } from '@/components/theme-toggle'

export default function Home() {
  const [email, setEmail] = useState('')
  const [subscribed, setSubscribed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    
    // Check current auth state
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleWaitlistSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 409) {
          setError('This email is already on the waitlist!')
        } else {
          setError(data.error || 'Failed to join waitlist. Please try again.')
        }
        setSubmitting(false)
        return
      }

      setSubscribed(true)
      setEmail('')
    } catch (err) {
      console.error('Waitlist signup error:', err)
      setError('Network error. Please try again.')
      setSubmitting(false)
    }
  }

  const faqs = [
    {
      question: "How does data transfer work?",
      answer: "The IMU logger streams data to your phone via Bluetooth LE. Your phone provides basic real-time analysis and uploads data to the cloud for in-depth post-processing. No SD cards or cables required."
    },
    {
      question: "How is my data stored and secured?",
      answer: "All data is encrypted in transit and at rest. Your ride data is stored in a secure PostgreSQL database with row-level security policies. You own your data completely and can export or delete it at any time."
    },
    {
      question: "Do I need the custom hardware?",
      answer: "Currently, yes. Vertex is designed to work with a custom IMU data logger that's in development. The mobile app requires BLE streaming from the Vertex logger."
    },
    {
      question: "Can I use this with my existing cycling computer?",
      answer: "Yes! Vertex complements your cycling computer. Upload your FIT file alongside IMU data to overlay power, heart rate, and GPS data with comfort and stability analysis."
    },
    {
      question: "What analysis features are included?",
      answer: "Vertex provides comfort metrics, body position stability scores, traction circle visualization, braking technique analysis, cornering forces, and road surface quality assessment."
    },
    {
      question: "Is there a mobile app?",
      answer: "Yes! The mobile app is in development. It connects to the logger via Bluetooth, provides basic real-time analysis during rides, and uploads data to the cloud for detailed post-ride review."
    }
  ]

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navigation */}
      <header className="border-b border-border bg-background sticky top-0 z-50">
        <div className="container mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <Link href={user ? "/dashboard" : "/"} className="text-xl sm:text-2xl font-normal tracking-tight hover:text-foreground transition-colors">
              VERTEX
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {/* Hide navigation links on mobile, show on md+ */}
              <div className="hidden md:flex items-center gap-1">
                <a href="#features" className="px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-md">
                  Features
                </a>
                <a href="#how-it-works" className="px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-md">
                  How It Works
                </a>
                <a href="#hardware" className="px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-md">
                  Hardware
                </a>
                <a href="#faq" className="px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-md">
                  FAQ
                </a>
              </div>
              
              {/* Theme toggle and auth section */}
              <div className="flex items-center gap-1 md:ml-2 md:pl-4 md:border-l border-border">
                <ThemeToggle />
                {loading ? (
                // Loading placeholder
                <div className="flex items-center gap-1">
                  <div className="h-9 rounded-md bg-muted animate-pulse" style={{ width: '82px' }}></div>
                  <div className="h-9 rounded-md bg-muted animate-pulse" style={{ width: '90px' }}></div>
                </div>
              ) : (
                user ? (
                  // Logged in: show dashboard link and profile button
                  <div className="flex items-center gap-1">
                    <Link 
                      href="/dashboard"
                      className="px-3 sm:px-4 py-2 text-foreground hover:bg-muted transition-colors rounded-md whitespace-nowrap text-xs sm:text-sm"
                    >
                      Dashboard
                    </Link>
                    <Link 
                      href="/settings"
                      className="p-2 hover:bg-muted transition-colors rounded-full"
                      title="Settings"
                    >
                      <User className="h-5 w-5 text-muted-foreground" />
                    </Link>
                  </div>
                ) : (
                  // Logged out: show login/signup
                  <div className="flex items-center gap-1">
                    <Link 
                      href="/login"
                      className="px-3 sm:px-4 py-2 text-foreground hover:bg-muted transition-colors rounded-md whitespace-nowrap text-xs sm:text-sm"
                    >
                      Log In
                    </Link>
                    <Link 
                      href="/signup"
                      className="px-3 sm:px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-md whitespace-nowrap text-xs sm:text-sm"
                    >
                      Sign Up
                    </Link>
                  </div>
                )
              )}
              </div>
            </nav>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative min-h-[500px] sm:min-h-[600px] md:min-h-[700px] flex items-end">
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
          <div className="container mx-auto px-4 sm:px-6 pb-8 sm:pb-12 md:pb-16 relative z-10">
            <div className="max-w-xl">
              <div className="bg-card/95 backdrop-blur-sm rounded-lg p-5 sm:p-6 md:p-8 shadow-2xl">
                <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-light tracking-tight leading-tight mb-3 sm:mb-4 text-card-foreground">
                  Measure how <em>well</em> you ride
                </h2>
                <p className="text-sm sm:text-base md:text-lg text-muted-foreground leading-relaxed mb-5 sm:mb-6">
                  Cycling is a technical sport, but standard cycling computers can only measure how <em>hard</em> you&apos;re riding.
                  Vertex measures stability, braking smoothness, cornering technique, traction limits,
                  and comfort with precision, high frequency, 9 axis motion analysis.
                </p>
                <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3">
                  {user ? (
                    <Link 
                      href="/dashboard"
                      className="px-5 sm:px-6 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-md text-center text-xs sm:text-sm font-medium"
                    >
                      Go to Dashboard
                    </Link>
                  ) : (
                    <a 
                      href="#waitlist"
                      className="px-5 sm:px-6 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-md text-center text-xs sm:text-sm font-medium"
                    >
                      Join Beta Waitlist
                    </a>
                  )}
                  <a 
                    href="#why"
                    className="px-5 sm:px-6 py-2.5 border border-border text-foreground hover:bg-muted transition-colors rounded-md text-center text-xs sm:text-sm font-medium"
                  >
                    Learn More
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Problem Statement */}
        <section id="why" className="bg-muted border-y border-border">
          <div className="container mx-auto px-4 sm:px-6 py-12 sm:py-16 md:py-20">
            <div className="max-w-4xl mx-auto">
              <h3 className="text-2xl sm:text-3xl font-light mb-6 sm:mb-8 text-center text-foreground">Skill and effort are equally important</h3>
              <p className="text-base sm:text-lg md:text-xl text-muted-foreground leading-relaxed text-center mb-8 sm:mb-12">
                We all love a social/sunset/soul ride with no data distractions, but we also love a training ride with as many objective metrics as possible.
                Effort and output are only half the equation, gps computers tell you how hard you&apos;re riding—power,
                heart rate, speed, <span className="relative group inline-block">
                  <span className="border-b border-dotted border-muted-foreground cursor-help">grade*</span>
                  <span className="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-80 p-4 bg-popover text-popover-foreground text-xs sm:text-sm leading-relaxed rounded-lg shadow-lg border border-border z-50">
                    *GPS grade is a lagging indicator, its accuracy fails when the grade changes rapidly, or isn&apos;t consistent. Vertex
                    not only logs all 9 axis (acceleration, gyro, magnetometer), but also broadcasts the current grade in real-time to your head unit.
                    Compatible only as a custom profile on Garmin devices, but we&apos;re advocating for the addition of this feature to the standard profile.
                    <span className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-8 border-transparent border-t-popover"></span>
                  </span>
                </span>. But they can&apos;t measure how well you&apos;re riding: your comfort, stability,
                traction, or technique.
              </p>
              
              {/* Comparison */}
              <div className="grid md:grid-cols-2 gap-4 sm:gap-6 md:gap-8">
                <div className="bg-card p-5 sm:p-6 md:p-8 rounded-lg border border-border">
                  <h4 className="font-medium mb-3 sm:mb-4 text-secondary uppercase text-xs sm:text-sm tracking-wide">
                    Standard Cycling Computer
                  </h4>
                  <ul className="space-y-1.5 sm:space-y-2 text-secondary text-sm sm:text-base">
                    <li>Speed & Cadence</li>
                    <li>Heart Rate</li>
                    <li>Power Output</li>
                    <li>Grade and total elevation</li>
                    <li className="text-secondary">Body position stability: ❌</li>
                    <li className="text-secondary">Cornering Forces: ❌</li>
                    <li className="text-secondary">Symmetry analysis: ❌</li>
                    <li className="text-secondary">Braking and acceleration: ❌</li>
                  </ul>
                </div>
                <div className="bg-primary text-primary-foreground p-5 sm:p-6 md:p-8 rounded-lg">
                  <h4 className="font-medium mb-3 sm:mb-4 uppercase text-xs sm:text-sm tracking-wide text-primary-foreground">
                    Vertex + IMU Logger
                  </h4>
                  <ul className="space-y-1.5 sm:space-y-2 text-sm sm:text-base">
                    <li>+ Comfort & Vibration Analysis</li>
                    <li>+ Body Position Stability</li>
                    <li>+ Traction & Cornering Forces</li>
                    <li>+ Braking Technique</li>
                    <li>+ Equipment Impact Testing</li>
                    <li>+ Road Surface Quality Metrics</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="container mx-auto px-4 sm:px-6 py-12 sm:py-16 md:py-20">
          <h3 className="text-2xl sm:text-3xl font-light mb-10 sm:mb-12 md:mb-16 text-center">How It Works</h3>
          <div className="grid md:grid-cols-3 gap-8 sm:gap-10 md:gap-12 max-w-5xl mx-auto">
            {/* Step 1 */}
            <div className="text-center">
              <div className="bg-muted rounded-lg aspect-square mb-4 sm:mb-6 flex items-center justify-center">
                <div className="text-secondary">
                  <svg className="w-16 sm:w-20 h-16 sm:h-20 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
              <div className="text-xs sm:text-sm text-secondary font-medium mb-2">STEP 1</div>
              <h4 className="text-lg sm:text-xl font-medium mb-2 sm:mb-3">Ride & Record</h4>
              <p className="text-sm sm:text-base text-secondary leading-relaxed">
                Mount the Vertex logger on your bike. Records and broadcasts 100Hz motion data during your ride—no cables, no SD cards to manage.
              </p>
            </div>

            {/* Step 2 */}
            <div className="text-center">
              <div className="bg-muted rounded-lg aspect-square mb-4 sm:mb-6 flex items-center justify-center">
                <div className="text-secondary">
                  <svg className="w-16 sm:w-20 h-16 sm:h-20 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
              <div className="text-xs sm:text-sm text-secondary font-medium mb-2">STEP 2</div>
              <h4 className="text-lg sm:text-xl font-medium mb-2 sm:mb-3">Stream via BLE (Bluetooth Low Energy)</h4>
              <p className="text-sm sm:text-base text-secondary leading-relaxed">
                Connect your phone to the logger via Bluetooth. View basic analysis on-device, then upload to the cloud for detailed post-ride processing.
              </p>
            </div>

            {/* Step 3 */}
            <div className="text-center">
              <div className="bg-muted rounded-lg aspect-square mb-4 sm:mb-6 flex items-center justify-center">
                <div className="text-secondary">
                  <svg className="w-16 sm:w-20 h-16 sm:h-20 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
              </div>
              <div className="text-xs sm:text-sm text-secondary font-medium mb-2">STEP 3</div>
              <h4 className="text-lg sm:text-xl font-medium mb-2 sm:mb-3">In depth Analysis</h4>
              <p className="text-sm sm:text-base text-secondary leading-relaxed">
                Review comfort metrics, stability scores, traction circle, and braking technique. Compare equipment changes with objective data.
              </p>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="bg-muted border-y border-border">
          <div className="container mx-auto px-4 sm:px-6 py-12 sm:py-16 md:py-20">
            <h3 className="text-2xl sm:text-3xl font-light mb-10 sm:mb-12 md:mb-16 text-center">What You Can Measure</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 md:gap-8 max-w-6xl mx-auto">
              {/* Feature 1 - Comfort */}
              <div className="bg-card p-4 sm:p-5 md:p-6 rounded-lg border border-border">
                <div className="bg-muted rounded-lg aspect-square mb-3 sm:mb-4 flex items-center justify-center">
                  <svg className="w-12 sm:w-14 md:w-16 h-12 sm:h-14 md:h-16 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h4 className="text-base sm:text-lg font-medium mb-1.5 sm:mb-2">Comfort & Vibration</h4>
                <p className="text-secondary text-xs sm:text-sm leading-relaxed">
                  Quantify road vibration objectively. Test if tire pressure, suspension, frames, or other equipment changes actually improve comfort.
                </p>
              </div>

              {/* Feature 2 - Stability */}
              <div className="bg-card p-4 sm:p-5 md:p-6 rounded-lg border border-border">
                <div className="bg-muted rounded-lg aspect-square mb-3 sm:mb-4 flex items-center justify-center">
                  <svg className="w-12 sm:w-14 md:w-16 h-12 sm:h-14 md:h-16 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                  </svg>
                </div>
                <h4 className="text-base sm:text-lg font-medium mb-1.5 sm:mb-2">Body Position Stability</h4>
                <p className="text-secondary text-xs sm:text-sm leading-relaxed">
                  Track how stable your body position is through corners. Measure improvements in bike control and technique.
                </p>
              </div>

              {/* Feature 3 - Traction */}
              <div className="bg-card p-4 sm:p-5 md:p-6 rounded-lg border border-border">
                <div className="bg-muted rounded-lg aspect-square mb-3 sm:mb-4 flex items-center justify-center">
                  <div className="text-center">
                    <svg className="w-12 sm:w-14 md:w-16 h-12 sm:h-14 md:h-16 mx-auto text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" strokeWidth={1.5} />
                      <circle cx="12" cy="12" r="6" strokeWidth={1.5} />
                      <circle cx="12" cy="12" r="2" strokeWidth={1.5} />
                    </svg>
                  </div>
                </div>
                <h4 className="text-base sm:text-lg font-medium mb-1.5 sm:mb-2">Traction & Cornering</h4>
                <p className="text-secondary text-xs sm:text-sm leading-relaxed">
                  See exact G-forces in the traction circle. Understand your grip limits and cornering confidence.
                </p>
              </div>

              {/* Feature 4 - Technique */}
              <div className="bg-card p-4 sm:p-5 md:p-6 rounded-lg border border-border">
                <div className="bg-muted rounded-lg aspect-square mb-3 sm:mb-4 flex items-center justify-center">
                  <svg className="w-12 sm:w-14 md:w-16 h-12 sm:h-14 md:h-16 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <h4 className="text-base sm:text-lg font-medium mb-1.5 sm:mb-2">Braking Technique</h4>
                <p className="text-secondary text-xs sm:text-sm leading-relaxed">
                  Analyze braking smoothness and deceleration patterns. Refine your technique for safer, faster riding.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Product Preview */}
        <section className="container mx-auto px-4 sm:px-6 py-12 sm:py-16 md:py-20">
          <h3 className="text-2xl sm:text-3xl font-light mb-6 sm:mb-8 text-center">Dashboard Preview</h3>
          <p className="text-center text-sm sm:text-base text-secondary mb-8 sm:mb-12 max-w-2xl mx-auto px-4">
            View your ride data in an intuitive interface designed for quick analysis and deep insights.
          </p>
          <div className="bg-muted rounded-lg aspect-video max-w-5xl mx-auto flex items-center justify-center border-2 border-border">
            <div className="text-center p-6 sm:p-8 md:p-12">
              <svg className="w-16 sm:w-20 md:w-24 h-16 sm:h-20 md:h-24 mx-auto text-secondary mb-3 sm:mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p className="text-sm sm:text-base text-secondary font-medium">Dashboard Screenshot</p>
              <p className="text-xs sm:text-sm text-secondary mt-1 sm:mt-2">Full interface preview with ride detail page</p>
            </div>
          </div>
        </section>

        {/* Hardware Section */}
        <section id="hardware" className="bg-muted border-y border-border">
          <div className="container mx-auto px-4 sm:px-6 py-12 sm:py-16 md:py-20">
            <div className="max-w-5xl mx-auto">
              <div className="grid md:grid-cols-2 gap-8 sm:gap-10 md:gap-12 items-center">
                {/* Left: Image Placeholder */}
                <div className="bg-muted rounded-lg aspect-[4/3] flex items-center justify-center">
                  <div className="text-center p-6 sm:p-8">
                    <svg className="w-16 sm:w-20 h-16 sm:h-20 mx-auto text-secondary mb-3 sm:mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                    </svg>
                    <p className="text-xs sm:text-sm text-secondary">IMU Logger on Bike</p>
                    <p className="text-xs text-secondary mt-1 sm:mt-2">Product photo placeholder</p>
                  </div>
                </div>

                {/* Right: Text */}
                <div>
                  <h3 className="text-2xl sm:text-3xl font-light mb-4 sm:mb-6">Custom IMU Data Logger</h3>
                  <p className="text-sm sm:text-base text-secondary mb-5 sm:mb-6 leading-relaxed">
                    Vertex works with a custom IMU data logger designed specifically for cycling motion analysis.
                  </p>
                  
                  <div className="space-y-2.5 sm:space-y-3 mb-6 sm:mb-8">
                    <div className="flex items-start gap-2 sm:gap-3">
                      <div className="text-secondary mt-1 text-sm sm:text-base">•</div>
                      <div>
                        <span className="font-medium text-sm sm:text-base">BNO055 9-axis IMU sensor</span>
                        <p className="text-xs sm:text-sm text-secondary">Accelerometer, gyroscope, and magnetometer</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 sm:gap-3">
                      <div className="text-secondary mt-1 text-sm sm:text-base">•</div>
                      <div>
                        <span className="font-medium text-sm sm:text-base">100Hz sampling rate</span>
                        <p className="text-xs sm:text-sm text-secondary">High-frequency capture for precise analysis</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 sm:gap-3">
                      <div className="text-secondary mt-1 text-sm sm:text-base">•</div>
                      <div>
                        <span className="font-medium text-sm sm:text-base">Bluetooth Low Energy streaming</span>
                        <p className="text-xs sm:text-sm text-secondary">Real-time data transfer to your phone—no SD cards</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 sm:gap-3">
                      <div className="text-secondary mt-1 text-sm sm:text-base">•</div>
                      <div>
                        <span className="font-medium text-sm sm:text-base">Mobile app integration</span>
                        <p className="text-xs sm:text-sm text-secondary">Basic analysis on-device, cloud upload for deep processing</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 sm:gap-3">
                      <div className="text-secondary mt-1 text-sm sm:text-base">•</div>
                      <div>
                        <span className="font-medium text-sm sm:text-base">10-15 hour battery life</span>
                        <p className="text-xs sm:text-sm text-secondary">USB-C rechargeable</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-warning border border-warning-border rounded-lg p-3 sm:p-4 mb-5 sm:mb-6">
                    <div className="flex items-start gap-2 sm:gap-3">
                      <svg className="w-4 sm:w-5 h-4 sm:h-5 text-warning mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div>
                        <p className="font-medium text-warning-foreground text-xs sm:text-sm mb-1">Hardware Status: In Development</p>
                        <p className="text-xs sm:text-sm text-warning-foreground">
                          The IMU logger hardware is currently in development. Join the waitlist to be notified when pre-orders open.
                        </p>
                      </div>
                    </div>
                  </div>

                  <a 
                    href="#waitlist"
                    className="inline-block px-5 sm:px-6 py-2.5 sm:py-3 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-md text-xs sm:text-sm font-medium"
                  >
                    Join Hardware Waitlist
                  </a>

                  <p className="text-xs sm:text-sm text-secondary mt-3 sm:mt-4">
                    Already have IMU data? Upload any CSV format with accelerometer and gyroscope data.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="container mx-auto px-4 sm:px-6 py-12 sm:py-16 md:py-20">
          <div className="max-w-3xl mx-auto">
            <h3 className="text-2xl sm:text-3xl font-light mb-8 sm:mb-10 md:mb-12 text-center">Frequently Asked Questions</h3>
            <div className="space-y-3 sm:space-y-4">
              {faqs.map((faq, index) => (
                <div key={index} className="border border-border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full px-4 sm:px-6 py-3 sm:py-4 text-left flex items-center justify-between hover:bg-muted transition-colors"
                  >
                    <span className="font-medium text-sm sm:text-base pr-3">{faq.question}</span>
                    <ChevronDown 
                      className={`w-4 sm:w-5 h-4 sm:h-5 text-secondary transition-transform flex-shrink-0 ${
                        openFaq === index ? 'transform rotate-180' : ''
                      }`}
                    />
                  </button>
                  {openFaq === index && (
                    <div className="px-4 sm:px-6 py-3 sm:py-4 bg-muted border-t border-border">
                      <p className="text-secondary leading-relaxed text-sm sm:text-base">{faq.answer}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Email Waitlist */}
        <section id="waitlist" className="bg-primary text-primary-foreground">
          <div className="container mx-auto px-4 sm:px-6 py-12 sm:py-16 md:py-20">
            <div className="max-w-2xl mx-auto text-center">
              <h3 className="text-2xl sm:text-3xl font-light mb-3 sm:mb-4">Join the Beta Waitlist</h3>
              <p className="text-sm sm:text-base text-primary-foreground mb-6 sm:mb-8 leading-relaxed px-4">
                Get early access to Vertex when we launch. Be the first to know when hardware pre-orders open.
              </p>
              
              {!subscribed ? (
                <>
                  <form onSubmit={handleWaitlistSignup} className="flex flex-col sm:flex-row gap-2.5 sm:gap-3 max-w-md mx-auto">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        setError(null)
                      }}
                      placeholder="your@email.com"
                      required
                      disabled={submitting}
                      className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 rounded-md bg-card text-primary placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm sm:text-base disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-5 sm:px-6 py-2.5 sm:py-3 bg-card text-primary hover:bg-muted transition-colors rounded-md font-medium text-sm sm:text-base disabled:opacity-50"
                    >
                      {submitting ? 'Joining...' : 'Join Waitlist'}
                    </button>
                  </form>
                  {error && (
                    <p className="text-sm text-destructive mt-3 text-center">{error}</p>
                  )}
                </>
              ) : (
                <div className="bg-primary border border-primary rounded-lg p-5 sm:p-6 max-w-md mx-auto">
                  <svg className="w-10 sm:w-12 h-10 sm:h-12 mx-auto mb-2 sm:mb-3 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-base sm:text-lg font-medium mb-1.5 sm:mb-2">You&apos;re on the list!</p>
                  <p className="text-secondary text-xs sm:text-sm">
                    We&apos;ll email you when Vertex launches and when hardware pre-orders open.
                  </p>
                </div>
              )}
              
              <p className="text-xs text-secondary mt-5 sm:mt-6 px-4">
                We&apos;ll only email you about Vertex updates. No spam, unsubscribe anytime.
              </p>
            </div>
          </div>
        </section>

        {/* Technology Section (Condensed) */}
        <section className="border-t border-border bg-card">
          <div className="container mx-auto px-4 sm:px-6 py-12 sm:py-14 md:py-16">
            <div className="max-w-4xl mx-auto">
              <h3 className="text-xl sm:text-2xl font-light mb-6 sm:mb-8 text-center">Built With</h3>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8 text-center">
                <div>
                  <h4 className="text-xs sm:text-sm font-medium text-secondary uppercase tracking-wide mb-2 sm:mb-3">
                    Frontend
                  </h4>
                  <p className="text-xs sm:text-sm text-secondary">
                    Next.js 15, TypeScript, Tailwind CSS, Recharts, Plotly.js
                  </p>
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-medium text-secondary uppercase tracking-wide mb-2 sm:mb-3">
                    Backend
                  </h4>
                  <p className="text-xs sm:text-sm text-secondary">
                    Supabase PostgreSQL, Supabase Auth, Inngest, AWS S3
                  </p>
                </div>
                <div className="sm:col-span-2 md:col-span-1">
                  <h4 className="text-xs sm:text-sm font-medium text-secondary uppercase tracking-wide mb-2 sm:mb-3">
                    Hardware
                  </h4>
                  <p className="text-xs sm:text-sm text-secondary">
                    ESP32, BNO055 IMU, SD Storage, 3D Printed Enclosure
                  </p>
                </div>
              </div>
              <div className="mt-6 sm:mt-8 pt-6 sm:pt-8 border-t border-border text-center">
                <a 
                  href="https://github.com/hawthorne-ben/vertex" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-xs sm:text-sm text-secondary hover:text-primary transition-colors"
                >
                  <svg className="w-4 sm:w-5 h-4 sm:h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                  </svg>
                  View on GitHub
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card">
        <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-3 sm:gap-4 text-xs sm:text-sm text-secondary">
            <p className="text-center md:text-left">© {new Date().getFullYear()} Vertex. Beta platform in development.</p>
            <div className="flex gap-4 sm:gap-6">
              <a href="#faq" className="hover:text-primary transition-colors">FAQ</a>
              <a href="https://github.com/hawthorne-ben/vertex" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                GitHub
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
