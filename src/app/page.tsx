'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import Image from 'next/image'

export default function Home() {
  const [email, setEmail] = useState('')
  const [subscribed, setSubscribed] = useState(false)
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

  const handleWaitlistSignup = (e: React.FormEvent) => {
    e.preventDefault()
    // TODO: Implement actual email capture
    console.log('Waitlist signup:', email)
    setSubscribed(true)
  }

  const faqs = [
    {
      question: "What data formats are supported?",
      answer: "Vertex supports CSV files from IMU sensors and standard FIT files from cycling computers. The IMU CSV should include timestamp, accelerometer (X/Y/Z), and gyroscope (X/Y/Z) data at a minimum sampling rate of 50Hz."
    },
    {
      question: "How is my data stored and secured?",
      answer: "All data is encrypted in transit and at rest. Your ride data is stored in a secure PostgreSQL database with row-level security policies. You own your data completely and can export or delete it at any time."
    },
    {
      question: "Do I need the custom hardware?",
      answer: "Currently, yes. Vertex is designed to work with a custom IMU data logger that's in development. If you already have IMU data in CSV format from another device, you can upload it directly."
    },
    {
      question: "Can I use this with my existing cycling computer?",
      answer: "Yes! Vertex complements your cycling computer. Upload your FIT file alongside IMU data to overlay power, heart rate, and GPS data with motion analysis."
    },
    {
      question: "What analysis features are included?",
      answer: "Vertex provides traction circle visualization, lean angle timeline analysis, braking event detection, cornering force analysis, GPS line comparison, and road surface quality assessment."
    },
    {
      question: "Is there a mobile app?",
      answer: "Not currently. Vertex is a web-based platform optimized for desktop analysis. Mobile support may be added in the future for viewing rides on the go."
    }
  ]

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navigation */}
      <header className="border-b border-stone-200 bg-white sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href={user ? "/dashboard" : "/"} className="text-2xl font-normal tracking-tight hover:text-stone-700 transition-colors">
              VERTEX
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <a href="#features" className="px-3 py-2 text-stone-600 hover:text-stone-900 hover:bg-stone-50 transition-colors rounded-md">
                Features
              </a>
              <a href="#how-it-works" className="px-3 py-2 text-stone-600 hover:text-stone-900 hover:bg-stone-50 transition-colors rounded-md">
                How It Works
              </a>
              <a href="#hardware" className="px-3 py-2 text-stone-600 hover:text-stone-900 hover:bg-stone-50 transition-colors rounded-md">
                Hardware
              </a>
              <a href="#faq" className="px-3 py-2 text-stone-600 hover:text-stone-900 hover:bg-stone-50 transition-colors rounded-md">
                FAQ
              </a>
              
              {/* Dynamic auth section */}
              {loading ? (
                // Loading placeholder - matches "Log In" + "Sign Up" widths
                // px-4 = 32px padding, text-sm ≈ 50px ("Log In"), 58px ("Sign Up")
                <div className="flex items-center gap-1 ml-2 pl-4 border-l border-stone-200">
                  <div className="h-9 rounded-md bg-stone-100 animate-pulse" style={{ width: '82px' }}></div>
                  <div className="h-9 rounded-md bg-stone-100 animate-pulse" style={{ width: '90px' }}></div>
                </div>
              ) : (
                user ? (
                  // Logged in: show dashboard link and profile button
                  <div className="flex items-center gap-1 ml-2 pl-4 border-l border-stone-200">
                    <Link 
                      href="/dashboard"
                      className="px-4 py-2 text-stone-900 hover:bg-stone-50 transition-colors rounded-md whitespace-nowrap"
                    >
                      Dashboard
                    </Link>
                    <Link 
                      href="/settings"
                      className="p-2 hover:bg-stone-50 transition-colors rounded-full"
                      title="Settings"
                    >
                      <User className="h-5 w-5 text-stone-600" />
                    </Link>
                  </div>
                ) : (
                  // Logged out: show login/signup
                  <div className="flex items-center gap-1 ml-2 pl-4 border-l border-stone-200">
                    <Link 
                      href="/login"
                      className="px-4 py-2 text-stone-900 hover:bg-stone-50 transition-colors rounded-md whitespace-nowrap"
                    >
                      Log In
                    </Link>
                    <Link 
                      href="/signup"
                      className="px-4 py-2 bg-stone-900 text-white hover:bg-stone-800 transition-colors rounded-md whitespace-nowrap"
                    >
                      Sign Up
                    </Link>
                  </div>
                )
              )}
            </nav>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative min-h-[600px] md:min-h-[700px] flex items-end">
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
          <div className="container mx-auto px-6 pb-12 md:pb-16 relative z-10">
            <div className="max-w-xl">
              <div className="bg-white/95 backdrop-blur-sm rounded-lg p-6 md:p-8 shadow-2xl">
                <h2 className="text-3xl md:text-4xl lg:text-5xl font-light tracking-tight leading-tight mb-4">
                  The Point of Performance
                </h2>
                <p className="text-base md:text-lg text-stone-600 leading-relaxed mb-6">
                  Measure how you actually ride. Understand cornering forces, braking smoothness, 
                  body position stability, and how your equipment affects comfort—with objective data 
                  from IMU motion analysis.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  {user ? (
                    <Link 
                      href="/dashboard"
                      className="px-6 py-2.5 bg-stone-900 text-white hover:bg-stone-800 transition-colors rounded-md text-center text-sm font-medium"
                    >
                      Go to Dashboard
                    </Link>
                  ) : (
                    <a 
                      href="#waitlist"
                      className="px-6 py-2.5 bg-stone-900 text-white hover:bg-stone-800 transition-colors rounded-md text-center text-sm font-medium"
                    >
                      Join Beta Waitlist
                    </a>
                  )}
                  <a 
                    href="#why"
                    className="px-6 py-2.5 border border-stone-300 text-stone-900 hover:bg-stone-50 transition-colors rounded-md text-center text-sm font-medium"
                  >
                    Learn More
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Problem Statement */}
        <section id="why" className="bg-stone-50 border-y border-stone-200">
          <div className="container mx-auto px-6 py-20">
            <div className="max-w-4xl mx-auto">
              <h3 className="text-3xl font-light mb-8 text-center">Why Vertex Exists</h3>
              <p className="text-xl text-stone-600 leading-relaxed text-center mb-12">
                Standard cycling computers track speed, cadence, and heart rate. 
                But they can't measure how you actually ride: cornering forces, braking technique, 
                body position stability, or how equipment changes affect your comfort and performance.
              </p>
              
              {/* Comparison */}
              <div className="grid md:grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-lg border border-stone-200">
                  <h4 className="font-medium mb-4 text-stone-500 uppercase text-sm tracking-wide">
                    Standard Cycling Computer
                  </h4>
                  <ul className="space-y-2 text-stone-600">
                    <li>• Speed & Cadence</li>
                    <li>• Heart Rate</li>
                    <li>• Power Output</li>
                    <li>• GPS Track</li>
                    <li className="text-stone-400">• Lean Angle: ❌</li>
                    <li className="text-stone-400">• G-Forces: ❌</li>
                    <li className="text-stone-400">• Cornering Analysis: ❌</li>
                  </ul>
                </div>
                <div className="bg-stone-900 text-white p-8 rounded-lg">
                  <h4 className="font-medium mb-4 uppercase text-sm tracking-wide text-stone-300">
                    Vertex + IMU Logger
                  </h4>
                  <ul className="space-y-2">
                    <li>• All Standard Metrics</li>
                    <li>• + Lean Angle & Cornering Forces</li>
                    <li>• + Braking Smoothness Analysis</li>
                    <li>• + Road Surface Quality (Vibration)</li>
                    <li>• + Body Position Stability</li>
                    <li>• + Equipment Impact Testing</li>
                    <li>• + Traction Circle & Line Analysis</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="container mx-auto px-6 py-20">
          <h3 className="text-3xl font-light mb-16 text-center">How It Works</h3>
          <div className="grid md:grid-cols-3 gap-12 max-w-5xl mx-auto">
            {/* Step 1 */}
            <div className="text-center">
              <div className="bg-stone-100 rounded-lg aspect-square mb-6 flex items-center justify-center">
                <div className="text-stone-400">
                  <svg className="w-20 h-20 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
              <div className="text-sm text-stone-500 font-medium mb-2">STEP 1</div>
              <h4 className="text-xl font-medium mb-3">Collect Data</h4>
              <p className="text-stone-600 leading-relaxed">
                Install the IMU logger on your bike via Garmin mount. Records 100Hz motion data to SD card during your ride.
              </p>
            </div>

            {/* Step 2 */}
            <div className="text-center">
              <div className="bg-stone-100 rounded-lg aspect-square mb-6 flex items-center justify-center">
                <div className="text-stone-400">
                  <svg className="w-20 h-20 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
              </div>
              <div className="text-sm text-stone-500 font-medium mb-2">STEP 2</div>
              <h4 className="text-xl font-medium mb-3">Upload Files</h4>
              <p className="text-stone-600 leading-relaxed">
                Drag and drop your IMU CSV file and optional FIT file from your cycling computer. Automatic ride detection and parsing.
              </p>
            </div>

            {/* Step 3 */}
            <div className="text-center">
              <div className="bg-stone-100 rounded-lg aspect-square mb-6 flex items-center justify-center">
                <div className="text-stone-400">
                  <svg className="w-20 h-20 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
              </div>
              <div className="text-sm text-stone-500 font-medium mb-2">STEP 3</div>
              <h4 className="text-xl font-medium mb-3">Analyze Your Riding</h4>
              <p className="text-stone-600 leading-relaxed">
                View cornering forces, braking smoothness, road surface quality, and body position stability. Test equipment changes with objective data.
              </p>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="bg-stone-50 border-y border-stone-200">
          <div className="container mx-auto px-6 py-20">
            <h3 className="text-3xl font-light mb-16 text-center">What You Can Measure</h3>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-6xl mx-auto">
              {/* Feature 1 */}
              <div className="bg-white p-6 rounded-lg border border-stone-200">
                <div className="bg-stone-100 rounded-lg aspect-square mb-4 flex items-center justify-center">
                  <div className="text-center">
                    <svg className="w-16 h-16 mx-auto text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" strokeWidth={1.5} />
                      <circle cx="12" cy="12" r="6" strokeWidth={1.5} />
                      <circle cx="12" cy="12" r="2" strokeWidth={1.5} />
                    </svg>
                  </div>
                </div>
                <h4 className="text-lg font-medium mb-2">Traction Circle</h4>
                <p className="text-stone-600 text-sm leading-relaxed">
                  See exact lateral and longitudinal G-forces plotted in real-time. Understand your bike's grip limits.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="bg-white p-6 rounded-lg border border-stone-200">
                <div className="bg-stone-100 rounded-lg aspect-square mb-4 flex items-center justify-center">
                  <svg className="w-16 h-16 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                  </svg>
                </div>
                <h4 className="text-lg font-medium mb-2">Lean Angle Timeline</h4>
                <p className="text-stone-600 text-sm leading-relaxed">
                  Track your maximum lean angle by corner. Identify which turns you're pushing hard vs. riding conservatively.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="bg-white p-6 rounded-lg border border-stone-200">
                <div className="bg-stone-100 rounded-lg aspect-square mb-4 flex items-center justify-center">
                  <svg className="w-16 h-16 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <h4 className="text-lg font-medium mb-2">Braking Analysis</h4>
                <p className="text-stone-600 text-sm leading-relaxed">
                  Identify heavy vs. smooth braking patterns. See deceleration events and optimize your brake points.
                </p>
              </div>

              {/* Feature 4 */}
              <div className="bg-white p-6 rounded-lg border border-stone-200">
                <div className="bg-stone-100 rounded-lg aspect-square mb-4 flex items-center justify-center">
                  <svg className="w-16 h-16 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h4 className="text-lg font-medium mb-2">Road Surface & Equipment</h4>
                <p className="text-stone-600 text-sm leading-relaxed">
                  Measure road vibration objectively. Test if tire pressure, handlebar, or saddle changes actually improve comfort.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Product Preview */}
        <section className="container mx-auto px-6 py-20">
          <h3 className="text-3xl font-light mb-8 text-center">Dashboard Preview</h3>
          <p className="text-center text-stone-600 mb-12 max-w-2xl mx-auto">
            View your ride data in an intuitive interface designed for quick analysis and deep insights.
          </p>
          <div className="bg-stone-100 rounded-lg aspect-video max-w-5xl mx-auto flex items-center justify-center border-2 border-stone-200">
            <div className="text-center p-12">
              <svg className="w-24 h-24 mx-auto text-stone-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p className="text-stone-500 font-medium">Dashboard Screenshot</p>
              <p className="text-sm text-stone-400 mt-2">Full interface preview with ride detail page</p>
            </div>
          </div>
        </section>

        {/* Hardware Section */}
        <section id="hardware" className="bg-stone-50 border-y border-stone-200">
          <div className="container mx-auto px-6 py-20">
            <div className="max-w-5xl mx-auto">
              <div className="grid md:grid-cols-2 gap-12 items-center">
                {/* Left: Image Placeholder */}
                <div className="bg-stone-200 rounded-lg aspect-[4/3] flex items-center justify-center">
                  <div className="text-center p-8">
                    <svg className="w-20 h-20 mx-auto text-stone-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                    </svg>
                    <p className="text-sm text-stone-500">IMU Logger on Bike</p>
                    <p className="text-xs text-stone-400 mt-2">Product photo placeholder</p>
                  </div>
                </div>

                {/* Right: Text */}
                <div>
                  <h3 className="text-3xl font-light mb-6">Custom IMU Data Logger</h3>
                  <p className="text-stone-600 mb-6 leading-relaxed">
                    Vertex works with a custom IMU data logger designed specifically for cycling motion analysis.
                  </p>
                  
                  <div className="space-y-3 mb-8">
                    <div className="flex items-start gap-3">
                      <div className="text-stone-400 mt-1">•</div>
                      <div>
                        <span className="font-medium">BNO055 9-axis IMU sensor</span>
                        <p className="text-sm text-stone-500">Accelerometer, gyroscope, and magnetometer</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="text-stone-400 mt-1">•</div>
                      <div>
                        <span className="font-medium">100Hz sampling rate</span>
                        <p className="text-sm text-stone-500">High-frequency capture for precise analysis</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="text-stone-400 mt-1">•</div>
                      <div>
                        <span className="font-medium">SD card data storage</span>
                        <p className="text-sm text-stone-500">Hours of ride data on a single card</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="text-stone-400 mt-1">•</div>
                      <div>
                        <span className="font-medium">Garmin mount compatible</span>
                        <p className="text-sm text-stone-500">Mounts to any bike via standard seatpost adapter</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="text-stone-400 mt-1">•</div>
                      <div>
                        <span className="font-medium">10-15 hour battery life</span>
                        <p className="text-sm text-stone-500">USB-C rechargeable</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div>
                        <p className="font-medium text-amber-900 text-sm mb-1">Hardware Status: In Development</p>
                        <p className="text-sm text-amber-800">
                          The IMU logger hardware is currently in development. Join the waitlist to be notified when pre-orders open.
                        </p>
                      </div>
                    </div>
                  </div>

                  <a 
                    href="#waitlist"
                    className="inline-block px-6 py-3 bg-stone-900 text-white hover:bg-stone-800 transition-colors rounded-md"
                  >
                    Join Hardware Waitlist
                  </a>

                  <p className="text-sm text-stone-500 mt-4">
                    Already have IMU data? Upload any CSV format with accelerometer and gyroscope data.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="container mx-auto px-6 py-20">
          <div className="max-w-3xl mx-auto">
            <h3 className="text-3xl font-light mb-12 text-center">Frequently Asked Questions</h3>
            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <div key={index} className="border border-stone-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-stone-50 transition-colors"
                  >
                    <span className="font-medium">{faq.question}</span>
                    <ChevronDown 
                      className={`w-5 h-5 text-stone-400 transition-transform ${
                        openFaq === index ? 'transform rotate-180' : ''
                      }`}
                    />
                  </button>
                  {openFaq === index && (
                    <div className="px-6 py-4 bg-stone-50 border-t border-stone-200">
                      <p className="text-stone-600 leading-relaxed">{faq.answer}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Email Waitlist */}
        <section id="waitlist" className="bg-stone-900 text-white">
          <div className="container mx-auto px-6 py-20">
            <div className="max-w-2xl mx-auto text-center">
              <h3 className="text-3xl font-light mb-4">Join the Beta Waitlist</h3>
              <p className="text-stone-300 mb-8 leading-relaxed">
                Get early access to Vertex when we launch. Be the first to know when hardware pre-orders open.
              </p>
              
              {!subscribed ? (
                <form onSubmit={handleWaitlistSignup} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                    className="flex-1 px-4 py-3 rounded-md bg-white text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400"
                  />
                  <button
                    type="submit"
                    className="px-6 py-3 bg-white text-stone-900 hover:bg-stone-100 transition-colors rounded-md font-medium"
                  >
                    Join Waitlist
                  </button>
                </form>
              ) : (
                <div className="bg-stone-800 border border-stone-700 rounded-lg p-6 max-w-md mx-auto">
                  <svg className="w-12 h-12 mx-auto mb-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-lg font-medium mb-2">You're on the list!</p>
                  <p className="text-stone-400 text-sm">
                    We'll email you when Vertex launches and when hardware pre-orders open.
                  </p>
                </div>
              )}
              
              <p className="text-xs text-stone-400 mt-6">
                We'll only email you about Vertex updates. No spam, unsubscribe anytime.
              </p>
            </div>
          </div>
        </section>

        {/* Technology Section (Condensed) */}
        <section className="border-t border-stone-200 bg-white">
          <div className="container mx-auto px-6 py-16">
            <div className="max-w-4xl mx-auto">
              <h3 className="text-2xl font-light mb-8 text-center">Built With</h3>
              <div className="grid md:grid-cols-3 gap-8 text-center">
                <div>
                  <h4 className="text-sm font-medium text-stone-500 uppercase tracking-wide mb-3">
                    Frontend
                  </h4>
                  <p className="text-sm text-stone-600">
                    Next.js 15, TypeScript, Tailwind CSS, Recharts, Plotly.js
                  </p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-stone-500 uppercase tracking-wide mb-3">
                    Backend
                  </h4>
                  <p className="text-sm text-stone-600">
                    Supabase PostgreSQL, Supabase Auth, Inngest, AWS S3
                  </p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-stone-500 uppercase tracking-wide mb-3">
                    Hardware
                  </h4>
                  <p className="text-sm text-stone-600">
                    ESP32, BNO055 IMU, SD Storage, 3D Printed Enclosure
                  </p>
                </div>
              </div>
              <div className="mt-8 pt-8 border-t border-stone-200 text-center">
                <a 
                  href="https://github.com/hawthorne-ben/vertex" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-stone-600 hover:text-stone-900 transition-colors"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
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
      <footer className="border-t border-stone-200 bg-white">
        <div className="container mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-stone-600">
            <p>© {new Date().getFullYear()} Vertex. Beta platform in development.</p>
            <div className="flex gap-6">
              <a href="#faq" className="hover:text-stone-900 transition-colors">FAQ</a>
              <a href="https://github.com/hawthorne-ben/vertex" target="_blank" rel="noopener noreferrer" className="hover:text-stone-900 transition-colors">
                GitHub
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
