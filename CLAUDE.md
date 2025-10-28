# Claude Code Rules for Vertex Project

## Core Principles

### 1. BALANCE AUTONOMY WITH USER CONTROL
- **Default**: Implement straightforward solutions directly when the path forward is clear
- **Ask first** when there are multiple valid approaches with different tradeoffs:
  - Architectural decisions (e.g., state management patterns, library choices)
  - Security-sensitive changes (e.g., authentication methods, data handling)
  - Breaking changes that affect multiple parts of the codebase
- **Always explain**: What you're doing and why as you work
- Use `AskUserQuestion` tool for genuine ambiguities, not routine implementations

### 2. NEVER AUTO-COMMIT
- **NEVER** run `git commit` unless explicitly instructed
- **NEVER** run `git add` + `git commit` automatically after making changes
- Wait for explicit instruction: "commit this" or "commit these changes"
- If changes are made, mention they're uncommitted and wait for user decision

### 3. COMPLETE LOGICAL UNITS OF WORK
- Work through related changes as a logical unit
- Don't artificially pause after every small step
- Provide clear summaries of what was done
- Pause at natural checkpoints: feature complete, tests passing, ready for commit
- Exception: Stop if you encounter unexpected errors or blockers

### 4. ASK WHEN GENUINELY AMBIGUOUS
- **Do ask** when:
  - Multiple approaches have significant tradeoffs
  - User requirements are unclear or could be interpreted multiple ways
  - Making architectural decisions that affect future development
- **Don't ask** when:
  - Following standard patterns already in the codebase
  - Implementing clearly specified requirements
  - Fixing obvious bugs or errors

### 5. PREFER LOCAL DEVELOPMENT FOR DEBUGGING
- **Always suggest local dev first** when debugging issues
- Use local development servers for testing before deploying
- Only deploy to production when local testing is complete
- **Benefits**: Faster iterations, no deployment costs, easier debugging
- **Exception**: Only use production when local environment differs significantly
- **  Hot Reload Reliability**: Always restart dev servers when testing new features - hot reload can be flaky with complex changes

## Project Structure Rules

### Folder Organization

#### `docs/` - Documentation Files
- **Purpose**: All project documentation and planning files
- **Contents**: .md files (APP.md, BUILD.md, README.md, DEPLOYMENT.md, etc.)
- **Status**: Excluded from git and Vercel deployments
- **Security**: Internal use only, may contain sensitive planning info

#### `scripts/` - Development Scripts and Tools
- **Purpose**: All executable scripts, tools, and test data
- **Contents**: .sh files, .py files, .js files, .csv test data
- **Status**: Excluded from git and Vercel deployments
- **Security**: May contain secrets, database credentials, or sensitive operations

#### `sql/` - Database Files
- **Purpose**: All database-related scripts and queries
- **Contents**: .sql files (schema, migrations, diagnostics, fixes)
- **Status**: Excluded from git and Vercel deployments
- **Security**: May contain sensitive database operations

### Security Rules

- **Database credentials**: `.db-credentials.local` - NEVER commit to git
- **Sensitive scripts**: All scripts in `scripts/` folder may contain secrets
- **Documentation**: Planning docs in `docs/` are for internal use only
- **SQL files**: May contain sensitive database operations

### Deployment Rules

- **Vercel deployments**: Only include `src/`, `public/`, and config files
- **Excluded from deployments**: `docs/`, `scripts/`, `sql/` folders
- **Public access**: Only files in `public/` directory are publicly accessible
- **Security**: No sensitive information in deployed code

### File Naming Conventions

- **Scripts**: Use descriptive names (e.g., `cleanup-orphaned-data.sh`)
- **SQL files**: Use descriptive names (e.g., `schema-enhancements-phase1.sql`)
- **Documentation**: Use descriptive names (e.g., `DEPLOYMENT.md`)

### Git Rules

- **Never commit**: `docs/`, `scripts/`, `sql/` folders
- **Never commit**: `.db-credentials.local` file
- **Always commit**: Source code changes in `src/` folder
- **Always commit**: Configuration files (package.json, next.config.ts, etc.)

## Development Workflow

### Debugging Pattern
- **For debugging**: Test locally first, deploy only when necessary
- **For production**: Only commit when features are complete and tested
- **Benefits**: Clean git history, faster iteration, easier rollbacks

### Logging
- **For development**: Include verbose logs during development
- **For production**: Remove all debug logs before committing
- **Benefits**: Easier development, better observability, clean prod deployment

### Local Development Priority
1. **Always suggest local dev first** for debugging
2. **Start local servers**: Use appropriate local development commands
3. **Test locally** before any production deployment
4. **Only deploy to prod** when local testing is complete

## Git Workflow

1. Make changes when requested
2. Complete the logical unit of work
3. Summarize what was done
4. Only commit when explicitly told
5. Only push when explicitly told

## Todo List Usage

- Use TodoWrite tool proactively for multi-step tasks
- Update todos as work progresses
- Keep todos granular enough to track progress
- Mark todos complete as soon as work is done
- Todos help both me and the user track progress

## Communication Style

- **Be concise but complete**: Explain what you're doing without excessive detail
- **Show code in context**: Use file references like `file.ts:123`
- **Report progress**: Mention what's working and what needs attention
- **Be direct**: If something won't work or is a bad idea, say so

## When to Implement Without Asking

- Implementing clearly specified requirements
- Fixing obvious bugs or build errors
- Following established patterns in the codebase
- Making changes the user explicitly requested
- Continuing work that's already been approved

## When to Ask First

- Architectural decisions with multiple valid approaches
- Security-sensitive implementations
- Breaking changes that affect APIs or data structures
- When user requirements could be interpreted multiple ways
- When there are significant tradeoffs between approaches

## Remember

I'm designed to work efficiently and autonomously while respecting your control. I'll make progress on clear tasks but ask when decisions have real tradeoffs. You stay in the driver's seat for commits, deployments, and strategic decisions.

---

**This file defines how Claude Code should work on the Vertex project.**
