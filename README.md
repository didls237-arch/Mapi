# Discord AI analysis bot

This project runs a Discord analysis server with `forum + thread` workflows and can talk to OpenClaw in two ways:

- `OPENCLAW_TRANSPORT=http`: call an HTTP gateway
- `OPENCLAW_TRANSPORT=cli`: execute a local OpenClaw bridge command

## Text commands

- `!analyze <kor|ex|coin> <ticker>`
- `!summary <macro|kor|ex|coin> [thread_id]`
- `!rollover <thread_id>`
- `!status`
- `!help`

Slash commands can still exist, but text commands are now the primary workflow.

## Quick start

```bash
cp .env.example .env
npm install
```

Fill at least these values in `.env`:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`
- `PG_CONNECTION_STRING`
- `OPENCLAW_TRANSPORT`

Then run:

```bash
npm run bootstrap:guild
npm run migrate
npm run build
npm run start
```

Run `npm run register:commands` only if you still want slash commands registered.

## OpenClaw CLI mode

Set:

```env
OPENCLAW_TRANSPORT=cli
OPENCLAW_CLI_COMMAND=/absolute/path/to/openclaw-discord-bridge
OPENCLAW_CLI_ARGS_JSON=[]
OPENCLAW_CLI_CWD=/home/mapi
```

The bot sends one JSON request to the bridge over stdin and expects one JSON object back on stdout.

Request shape:

```json
{
  "action": "start_discussion | discussion_turn | final_report",
  "discussion_id": "optional-string",
  "payload": {}
}
```

Expected stdout examples:

```json
{ "discussion_id": "abc-123" }
```

```json
{ "content": "turn output", "citations": [], "risk_score": 3 }
```

```json
{
  "report_id": "rpt-1",
  "verdict": "WAIT",
  "confidence": 82,
  "entry": "entry text",
  "tp": "tp text",
  "sl": "sl text",
  "consensus": "final summary",
  "persona_comments": [
    { "persona": "technical analyst", "opinion": "...", "stance": "찬성" }
  ],
  "sources": ["source-1", "source-2"],
  "created_at": "2026-03-11T00:00:00.000Z"
}
```

CLI mode is the right fit when OpenClaw is already operated as a local CLI or Telegram-driven workflow rather than a REST API service.
