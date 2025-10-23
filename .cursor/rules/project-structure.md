# Project Structure Rules for Vertex

## Folder Organization

### `docs/` - Documentation Files
- **Purpose**: All project documentation and planning files
- **Contents**: .md files (APP.md, BUILD.md, README.md, DEPLOYMENT.md, etc.)
- **Status**: Excluded from git and Vercel deployments
- **Security**: Internal use only, may contain sensitive planning info

### `scripts/` - Development Scripts and Tools
- **Purpose**: All executable scripts, tools, and test data
- **Contents**: .sh files, .py files, .js files, .csv test data
- **Status**: Excluded from git and Vercel deployments
- **Security**: May contain secrets, database credentials, or sensitive operations

### `sql/` - Database Files
- **Purpose**: All database-related scripts and queries
- **Contents**: .sql files (schema, migrations, diagnostics, fixes)
- **Status**: Excluded from git and Vercel deployments
- **Security**: May contain sensitive database operations

## Security Rules

- **Database credentials**: `.db-credentials.local` - NEVER commit to git
- **Sensitive scripts**: All scripts in `scripts/` folder may contain secrets
- **Documentation**: Planning docs in `docs/` are for internal use only
- **SQL files**: May contain sensitive database operations

## Deployment Rules

- **Vercel deployments**: Only include `src/`, `public/`, and config files
- **Excluded from deployments**: `docs/`, `scripts/`, `sql/` folders
- **Public access**: Only files in `public/` directory are publicly accessible
- **Security**: No sensitive information in deployed code

## Development Workflow

- **Local development**: Use scripts from `scripts/` folder
- **Database operations**: Use SQL files from `sql/` folder
- **Documentation**: Update files in `docs/` folder
- **Source code**: Keep all application code in `src/` folder

## File Naming Conventions

- **Scripts**: Use descriptive names (e.g., `cleanup-orphaned-data.sh`)
- **SQL files**: Use descriptive names (e.g., `schema-enhancements-phase1.sql`)
- **Documentation**: Use descriptive names (e.g., `DEPLOYMENT.md`)

## Git Rules

- **Never commit**: `docs/`, `scripts/`, `sql/` folders
- **Never commit**: `.db-credentials.local` file
- **Always commit**: Source code changes in `src/` folder
- **Always commit**: Configuration files (package.json, next.config.ts, etc.)

## Vercel Rules

- **Deploy**: Only application code and public assets
- **Exclude**: All development tools and documentation
- **Security**: No sensitive information in deployed code
- **Performance**: Minimal deployment size for faster builds
