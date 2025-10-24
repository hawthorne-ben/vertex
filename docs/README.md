# Vertex Documentation

This directory contains the complete technical documentation for the Vertex IMU cycling data analysis platform, organized for optimal AI reference and human navigation.

## Structure

```
docs/
├── index.md                    # Main documentation homepage
├── _config.yml                 # Jekyll configuration
├── _layouts/
│   └── default.html           # Custom layout with navigation
├── architecture/              # System design and technical architecture
│   ├── index.md
│   ├── system-design.md
│   └── database.md
├── development/               # Development guides and procedures
│   ├── index.md
│   ├── DEPLOYMENT.md
│   ├── LOCAL_DEV_LIMITATIONS.md
│   ├── BUILD.md
│   └── PHASE1_DEPLOYMENT_GUIDE.md
├── features/                  # Feature implementation guides
│   ├── index.md
│   ├── CHARTING_IMPLEMENTATION.md
│   ├── PROGRESS_TRACKING_IMPLEMENTATION.md
│   └── THEME_SYSTEM.md
├── operations/                # Operations and maintenance
│   ├── index.md
│   ├── OBSERVABILITY_PIPELINE.md
│   ├── STORAGE_CLEANUP.md
│   └── SAVE_STATE.md
├── api-reference/             # API documentation
│   ├── index.md
│   └── upload.md
└── APP.md                     # Original comprehensive documentation
```

## GitHub Pages Setup

### 1. Enable GitHub Pages
1. Go to your repository Settings
2. Navigate to Pages section
3. Select "Deploy from a branch"
4. Choose `main` branch and `/docs` folder
5. Your docs will be available at `https://yourusername.github.io/vertex`

### 2. Jekyll Configuration
The `_config.yml` file configures:
- Site metadata and navigation
- Collections for organized content
- SEO and sitemap generation
- Custom layout and styling

### 3. Local Development
To preview the documentation locally:

```bash
# Install Jekyll
gem install jekyll bundler

# Navigate to docs directory
cd docs

# Install dependencies
bundle install

# Start local server
bundle exec jekyll serve

# View at http://localhost:4000
```

## AI Reference Optimization

This documentation is structured for efficient AI reference:

### Direct File Access
- Each topic has its own focused file
- No need to search through massive documents
- Clear file naming conventions

### Semantic Organization
- Related topics grouped logically
- Cross-references between sections
- Consistent structure across all files

### Quick Lookup Guide
- **Architecture questions** → `/architecture/` section
- **Development issues** → `/development/` section
- **Feature implementation** → `/features/` section
- **Operations problems** → `/operations/` section
- **API usage** → `/api-reference/` section

## Content Guidelines

### File Structure
- Use front matter for metadata
- Include clear headings and navigation
- Add cross-references to related topics
- Keep files focused and concise

### Status Tracking
- Use status badges for feature completion
- Include last updated dates
- Track implementation progress

### Code Examples
- Include practical code snippets
- Show both success and error cases
- Provide complete working examples

## Maintenance

### Adding New Documentation
1. Create new file in appropriate section
2. Add front matter with title and description
3. Update section index.md with new content
4. Add cross-references from related files

### Updating Existing Documentation
1. Update content and last modified date
2. Update cross-references if needed
3. Test local Jekyll build
4. Commit and push changes

## Private Hosting

This documentation is hosted privately on GitHub Pages:
- Repository remains private
- Documentation accessible only to authorized users
- No sensitive information exposed publicly
- Easy to make public later if needed
