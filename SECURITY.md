# Security Policy

## Supported Versions

Vertex is currently in alpha development (v0.1.0). Security updates will be provided for:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

As the project matures, this policy will be updated to reflect long-term support for stable versions.

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please follow these guidelines:

### What to Report

Please report any security issues including but not limited to:

- Authentication or authorization bypasses
- Data exposure or privacy issues
- Code injection vulnerabilities
- Cross-site scripting (XSS) or cross-site request forgery (CSRF)
- SQL injection or other database vulnerabilities
- Denial of service vulnerabilities
- Issues with dependency packages
- Firmware vulnerabilities (BLE security, data transmission)
- Any other security concerns

### How to Report

**DO NOT** create a public GitHub issue for security vulnerabilities.

Instead, please report security issues via:

1. **GitHub Security Advisories** (preferred):
   - Navigate to the [Security tab](https://github.com/your-org/vertex/security/advisories)
   - Click "Report a vulnerability"
   - Provide detailed information about the vulnerability

2. **Email** (alternative):
   - Send details to: security@ridevertex.com
   - Use "SECURITY" in the subject line
   - Include detailed steps to reproduce

### What to Include

When reporting a vulnerability, please provide:

- **Description**: Clear description of the vulnerability
- **Impact**: Potential impact and attack scenarios
- **Steps to Reproduce**: Detailed steps to reproduce the issue
- **Affected Components**: Which parts of the system are affected (web, android, firmware)
- **Suggested Fix**: If you have ideas for remediation (optional)
- **Your Contact Information**: So we can follow up with questions

### Response Timeline

You can expect:

- **Initial Response**: Within 48 hours acknowledging receipt
- **Status Update**: Within 7 days with assessment and timeline
- **Resolution**: Varies by severity, but we aim for:
  - Critical: 7 days
  - High: 14 days
  - Medium: 30 days
  - Low: 60 days

### Disclosure Policy

- **Coordinated Disclosure**: We request 90 days from initial report before public disclosure
- **Credit**: We will acknowledge security researchers in our release notes (if desired)
- **Communication**: We will keep you informed throughout the remediation process
- **CVE Assignment**: We will work to assign CVEs for significant vulnerabilities

### Safe Harbor

We consider security research conducted under this policy to be:

- Authorized in accordance with laws
- Conducted in good faith
- Not disruptive to our users or services

We will not pursue legal action against researchers who:

- Make a good faith effort to comply with this policy
- Do not access, modify, or delete user data beyond what is necessary to demonstrate the vulnerability
- Do not intentionally harm the availability or integrity of our services
- Report vulnerabilities promptly and privately

## Security Best Practices for Contributors

When contributing to Vertex:

- Never commit secrets, API keys, or credentials
- Use environment variables for sensitive configuration
- Follow secure coding guidelines for your component (web, Android, firmware)
- Keep dependencies up to date
- Review security implications of third-party libraries
- Test authentication and authorization flows
- Validate and sanitize all user inputs
- Use HTTPS for all external communications
- Implement proper error handling that doesn't leak sensitive information

## Security Features

Vertex implements several security measures:

- **Authentication**: User authentication via Clerk with OAuth support
- **Authorization**: Row Level Security (RLS) in Supabase PostgreSQL
- **Data Storage**: Secure file storage with presigned URLs
- **BLE Security**: Encrypted communication between devices and app
- **Input Validation**: Server-side validation of all user inputs
- **HTTPS**: All web traffic encrypted in transit

## Questions?

If you have questions about this security policy or need clarification, please open a general issue or contact security@ridevertex.com.

---

Thank you for helping keep Vertex and our users safe!
