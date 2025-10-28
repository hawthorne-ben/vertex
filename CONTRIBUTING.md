# Contributing to Vertex

Thank you for your interest in contributing to Vertex! This document provides guidelines for contributing to the project.

## Getting Started

### Prerequisites

- **Node.js**: >= 18.0.0
- **npm**: Latest version recommended
- **Git**: For version control

#### Platform-Specific Requirements

**For Android Development:**
- Android Studio with Android SDK
- Java Development Kit (JDK) 17 or later
- React Native development environment setup
- See [android/README.md](./android/README.md) for detailed setup

**For Firmware Development:**
- Arduino IDE or Arduino CLI
- ESP32 board support
- See [firmware/README_FIRMWARE.md](./firmware/README_FIRMWARE.md) for detailed setup

### Setting Up Your Development Environment

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/your-username/vertex.git
   cd vertex
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Choose your component to work on:**

   **Web Platform:**
   ```bash
   npm run dev:web
   # Opens on http://localhost:3000
   ```

   **Android App:**
   ```bash
   cd android
   npm install
   npm run android
   ```

   **Firmware:**
   See [firmware/README_FIRMWARE.md](./firmware/README_FIRMWARE.md) for Arduino setup.

## Monorepo Structure

Vertex uses a monorepo structure with independent versioning:

```
vertex/
├── packages/          # Shared packages
│   ├── vtx-format/   # VTX binary format specification
│   └── vtx-constants/# Shared format constants
├── web/              # Next.js web platform
├── android/          # React Native Android app
├── firmware/         # ESP32 IMU firmware
└── docs/             # Documentation
```

## Making Changes

### Branching Strategy

- Create feature branches from `main`
- Use descriptive branch names: `feature/add-xyz`, `fix/issue-123`, `docs/update-readme`

### Development Workflow

1. **Create a new branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes:**
   - Write clear, self-documenting code
   - Add comments for complex logic
   - Update documentation as needed

3. **Test your changes:**
   - Test locally before committing
   - Ensure all builds pass (web and Android if applicable)
   - Run relevant tests if available

4. **Commit your changes:**
   ```bash
   git add .
   git commit -m "Brief description of changes"
   ```

### Code Style Guidelines

**TypeScript/JavaScript (Web & Android):**
- Use TypeScript for type safety
- Follow existing code formatting patterns
- Use meaningful variable and function names
- Prefer `const` over `let`, avoid `var`
- Use async/await over callbacks

**Arduino/C++ (Firmware):**
- Follow Arduino style conventions
- Use clear variable names
- Comment hardware-specific implementations
- Test on actual hardware when possible

**Documentation:**
- Use clear, concise language
- Include code examples where helpful
- Update relevant docs when changing functionality

### Commit Message Guidelines

Write clear, descriptive commit messages:

```
Brief summary of changes (50 chars or less)

More detailed explanation if needed. Explain the problem
this commit solves and why this approach was chosen.

- Use bullet points for multiple changes
- Reference issue numbers: Fixes #123
```

**Good examples:**
- `Add lean angle visualization to ride detail page`
- `Fix BLE connection timeout on Android 14`
- `Update VTX format to support GPS data`

**Avoid:**
- `fixed bug`
- `updates`
- `wip`

## Testing

### Web Platform
```bash
cd web
npm run build  # Ensure production build succeeds
```

### Android App
```bash
cd android
./android/gradlew assembleDebug -p android   # Debug build
./android/gradlew assembleRelease -p android # Release build
```

### Firmware
- Flash to physical hardware and test functionality
- Document any hardware-specific behaviors

## Submitting Pull Requests

1. **Push your branch to your fork:**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create a Pull Request:**
   - Provide a clear title and description
   - Reference any related issues
   - Include screenshots for UI changes
   - List testing steps performed

3. **PR Description Template:**
   ```markdown
   ## Summary
   Brief description of what this PR does.

   ## Changes
   - List of specific changes made
   - Another change

   ## Testing
   - [ ] Tested locally on web platform
   - [ ] Tested on Android device
   - [ ] Verified build succeeds
   - [ ] Updated documentation

   ## Related Issues
   Fixes #123
   Related to #456
   ```

4. **Address feedback:**
   - Respond to review comments
   - Make requested changes
   - Push updates to the same branch

## Versioning

This project uses independent versioning with Lerna:

- Each component (web, android, firmware, packages) versions independently
- Versioning is handled by maintainers during releases
- See [docs/VERSIONING_STRATEGY.md](./docs/VERSIONING_STRATEGY.md) for details

## Need Help?

- Check existing [documentation](./docs/)
- Review [open issues](https://github.com/your-org/vertex/issues)
- Create a new issue for questions or bugs

## Code of Conduct

Please note that this project follows our [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## License

By contributing to Vertex, you agree that your contributions will be licensed under the same license as the project.

---

Thank you for contributing to Vertex!
