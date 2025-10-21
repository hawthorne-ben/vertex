export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">VERTEX</h1>
            <nav className="flex gap-6 text-sm">
              <a href="#features" className="text-neutral-600 hover:text-neutral-900 transition-colors">
                Features
              </a>
              <a href="#technology" className="text-neutral-600 hover:text-neutral-900 transition-colors">
                Technology
              </a>
              <a href="#about" className="text-neutral-600 hover:text-neutral-900 transition-colors">
                About
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
            <p className="text-xl md:text-2xl text-neutral-600 leading-relaxed mb-12 max-w-2xl">
              Analyze IMU cycling data with precision. Gain detailed insights into cornering forces, 
              braking behavior, and riding dynamics.
            </p>
            <div className="flex gap-4">
              <button className="px-6 py-3 bg-neutral-900 text-white hover:bg-neutral-800 transition-colors rounded-md">
                Coming Soon
              </button>
              <a 
                href="https://github.com/bhawthorne/vertex" 
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-3 border border-neutral-300 text-neutral-900 hover:bg-neutral-50 transition-colors rounded-md"
              >
                View on GitHub
              </a>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="bg-neutral-50 border-y border-neutral-200">
          <div className="container mx-auto px-6 py-20">
            <h3 className="text-3xl font-light mb-12">Core Capabilities</h3>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="space-y-3">
                <h4 className="text-xl font-medium">Data Management</h4>
                <p className="text-neutral-600 leading-relaxed">
                  Upload large CSV IMU logs and FIT files. Automatic time-series extraction 
                  and intelligent ride definition.
                </p>
              </div>
              <div className="space-y-3">
                <h4 className="text-xl font-medium">Advanced Analytics</h4>
                <p className="text-neutral-600 leading-relaxed">
                  Traction circles, lean angle analysis, braking events, and road surface 
                  quality assessment with precision metrics.
                </p>
              </div>
              <div className="space-y-3">
                <h4 className="text-xl font-medium">Visualization</h4>
                <p className="text-neutral-600 leading-relaxed">
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
              <h4 className="text-lg font-medium text-neutral-500 uppercase tracking-wide text-sm">
                Frontend
              </h4>
              <ul className="space-y-2 text-neutral-700">
                <li>Next.js 14 with App Router</li>
                <li>TypeScript & Tailwind CSS</li>
                <li>Recharts & Plotly.js</li>
                <li>TanStack Query</li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="text-lg font-medium text-neutral-500 uppercase tracking-wide text-sm">
                Backend
              </h4>
              <ul className="space-y-2 text-neutral-700">
                <li>Supabase (PostgreSQL)</li>
                <li>Clerk Authentication</li>
                <li>Inngest Background Jobs</li>
                <li>AWS S3 Storage</li>
              </ul>
            </div>
          </div>
        </section>

        {/* About Section */}
        <section id="about" className="bg-neutral-50 border-y border-neutral-200">
          <div className="container mx-auto px-6 py-20">
            <div className="max-w-3xl">
              <h3 className="text-3xl font-light mb-6">About Vertex</h3>
              <div className="space-y-4 text-neutral-600 leading-relaxed text-lg">
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
      <footer className="border-t border-neutral-200 bg-white">
        <div className="container mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-neutral-600">
              © {new Date().getFullYear()} Vertex. In development.
            </p>
            <div className="flex gap-6 text-sm">
              <a 
                href="https://github.com/bhawthorne/vertex" 
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-600 hover:text-neutral-900 transition-colors"
              >
                GitHub
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

