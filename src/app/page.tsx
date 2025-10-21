export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-normal tracking-tight">VERTEX</h1>
            <nav className="flex gap-6 text-sm items-center">
              <a href="#features" className="text-stone-600 hover:text-stone-900 transition-colors">
                Features
              </a>
              <a href="#technology" className="text-stone-600 hover:text-stone-900 transition-colors">
                Technology
              </a>
              <a href="#about" className="text-stone-600 hover:text-stone-900 transition-colors">
                About
              </a>
              <a 
                href="/login"
                className="px-4 py-2 text-stone-900 hover:bg-stone-50 transition-colors rounded-md"
              >
                Log In
              </a>
              <a 
                href="/signup"
                className="px-4 py-2 bg-stone-900 text-white hover:bg-stone-800 transition-colors rounded-md"
              >
                Sign Up
              </a>
            </nav>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="container mx-auto px-6 py-24 md:py-32">
          <div className="max-w-4xl">
            <h2 className="text-5xl md:text-7xl font-light tracking-tight leading-tight mb-6">
              The Point of Performance
            </h2>
            <p className="text-xl md:text-2xl text-stone-600 leading-relaxed mb-12 max-w-2xl">
              Analyze IMU cycling data with precision. Gain detailed insights into cornering forces, 
              braking behavior, and riding dynamics.
            </p>
            <div className="flex gap-4">
              <a 
                href="/signup"
                className="px-6 py-3 bg-stone-900 text-white hover:bg-stone-800 transition-colors rounded-md"
              >
                Get Started
              </a>
              <a 
                href="/login"
                className="px-6 py-3 border border-stone-300 text-stone-900 hover:bg-stone-50 transition-colors rounded-md"
              >
                Sign In
              </a>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="bg-stone-50 border-y border-stone-200">
          <div className="container mx-auto px-6 py-20">
            <h3 className="text-3xl font-light mb-12">Core Capabilities</h3>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="space-y-3">
                <h4 className="text-xl font-medium">Data Management</h4>
                <p className="text-stone-600 leading-relaxed">
                  Upload large CSV IMU logs and FIT files. Automatic time-series extraction 
                  and intelligent ride definition.
                </p>
              </div>
              <div className="space-y-3">
                <h4 className="text-xl font-medium">Advanced Analytics</h4>
                <p className="text-stone-600 leading-relaxed">
                  Traction circles, lean angle analysis, braking events, and road surface 
                  quality assessment with precision metrics.
                </p>
              </div>
              <div className="space-y-3">
                <h4 className="text-xl font-medium">Visualization</h4>
                <p className="text-stone-600 leading-relaxed">
                  Interactive charts, GPS track overlays, and power analysis. Export 
                  processed data and charts for further analysis.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Technology Section */}
        <section id="technology" className="container mx-auto px-6 py-20">
          <h3 className="text-3xl font-light mb-12">Technology Stack</h3>
          <div className="grid md:grid-cols-2 gap-12 max-w-4xl">
            <div className="space-y-4">
              <h4 className="text-lg font-medium text-stone-500 uppercase tracking-wide text-sm">
                Frontend
              </h4>
              <ul className="space-y-2 text-stone-700">
                <li>Next.js 14 with App Router</li>
                <li>TypeScript & Tailwind CSS</li>
                <li>Recharts & Plotly.js</li>
                <li>TanStack Query</li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="text-lg font-medium text-stone-500 uppercase tracking-wide text-sm">
                Backend
              </h4>
              <ul className="space-y-2 text-stone-700">
                <li>Supabase (PostgreSQL)</li>
                <li>Supabase Auth</li>
                <li>Inngest Background Jobs</li>
                <li>AWS S3 Storage</li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-12 border-t border-stone-200">
            <a 
              href="https://github.com/hawthorne-ben/vertex" 
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              View on GitHub
            </a>
          </div>
        </section>

        {/* About Section */}
        <section id="about" className="bg-stone-50 border-y border-stone-200">
          <div className="container mx-auto px-6 py-20">
            <div className="max-w-3xl">
              <h3 className="text-3xl font-light mb-6">About Vertex</h3>
              <div className="space-y-4 text-stone-600 leading-relaxed text-lg">
                <p>
                  Vertex is a web-based platform for analyzing IMU cycling data from custom hardware. 
                  It enables cyclists to gain detailed insights into their riding dynamics by combining 
                  high-frequency IMU data with standard cycling computer FIT files.
                </p>
                <p>
                  Designed with a subtle editorial aesthetic, Vertex delivers sophisticated analytics 
                  typically found in professional racing telemetry systems with an accessible, 
                  modern interface.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-200 bg-white">
        <div className="container mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-stone-600">
              © {new Date().getFullYear()} Vertex. In development.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}

