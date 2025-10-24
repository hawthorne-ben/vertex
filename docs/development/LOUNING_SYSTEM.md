# Logging System

The Vertex application includes a comprehensive logging system for development and debugging.

## Log Files

All logs are stored in the `logs/` directory in the project root:

- **`logs/dev.log`** - Next.js development server logs
- **`logs/inngest.log`** - Inngest CLI logs

## NPM Scripts

### Development with Logging

```bash
# Start Next.js dev server with logging
npm run dev:log

# Start Inngest CLI with logging
npm run dev:inngest:log
```

### Log Monitoring

```bash
# Tail both dev and Inngest logs
./scripts/tail-logs.sh

# Tail only dev logs
./scripts/tail-logs.sh dev

# Tail only Inngest logs
./scripts/tail-logs.sh inngest
```

### Manual Log Monitoring

```bash
# Watch dev logs
tail -f logs/dev.log

# Watch Inngest logs
tail -f logs/inngest.log

# Watch both logs simultaneously
tail -f logs/dev.log logs/inngest.log
```

## Logging Features

### Real-time Monitoring
- All output is piped to log files using `tee` command
- Logs are written in real-time as the applications run
- You can tail logs to watch activity in real-time

### Persistent Storage
- All logs are saved to files for later review
- Logs persist across application restarts
- Historical logs are available for debugging

### Separate Log Streams
- Development server logs are separate from Inngest logs
- Each service has its own log file for easier debugging
- Clear separation makes it easier to identify issues

## Usage Examples

### Start Development with Logging
```bash
# Terminal 1: Start Next.js with logging
npm run dev:log

# Terminal 2: Start Inngest with logging
npm run dev:inngest:log

# Terminal 3: Monitor logs
./scripts/tail-logs.sh
```

### Debug Issues
```bash
# Check recent errors in dev logs
tail -20 logs/dev.log

# Watch for specific patterns
grep -i "error" logs/dev.log

# Monitor Inngest processing
tail -f logs/inngest.log
```

## Log File Locations

- **Development**: `logs/dev.log`
- **Inngest**: `logs/inngest.log`
- **Script Location**: `scripts/tail-logs.sh`

## Benefits

1. **Visibility**: All application output is captured and visible
2. **Debugging**: Historical logs help identify issues
3. **Monitoring**: Real-time log monitoring for active development
4. **Separation**: Clear separation between different services
5. **Persistence**: Logs survive application restarts

## Troubleshooting

### Empty Log Files
If log files are empty, ensure you're using the logging-enabled npm scripts:
- Use `npm run dev:log` instead of `npm run dev`
- Use `npm run dev:inngest:log` instead of `npm run dev:inngest`

### Missing Log Directory
If the `logs/` directory doesn't exist, it will be created automatically when you run the logging-enabled scripts.

### Permission Issues
If you can't write to log files, ensure the `logs/` directory has proper write permissions:
```bash
chmod 755 logs/
```
