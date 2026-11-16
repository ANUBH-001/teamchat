# Team Chat + AI Task Tracker (Android, WhatsApp-style)
Plan: C:\Users\Manish\.claude\plans\pasted-content-id-0595-joyful-frost.md (read only the section you need)

## Rules
- TESTING: default is none. Manish said (2026-11-16) to do ONE full local test pass after Firebase removal, using a local MySQL. Only that pass is allowed; any further testing needs his new go-ahead. Tell every sub-agent whether tests are allowed.
- Keep it SIMPLE: Express + MySQL (mysql2, plain SQL) + Expo RN. No Docker, ORM, monorepo tools, extra frameworks.
- Order: build -> Git (only when told; never commit .env/secrets; ask before push) -> deploy (only when told). Local build only until then.
- AI keys only in server .env. Soft delete only (deleted_at).

## Docs (docs/ folder) - update after EVERY phase or change
- ProjectContent.md (full project idea/decisions), projectProgess.md (done / remaining / current work / next), Frontend.md (run, structure, screens, how to collaborate), backend.md (setup, all APIs: request, response, errors, DB, env).
- No testing instructions beyond how to run/use the app. Docs must be accurate to the code.
- Start detailed; as they grow, CONDENSE: merge old/finished details into short summaries, delete outdated text, keep each file small (target under ~150 lines). Never just append forever.
- Each agent that changes behavior updates the relevant doc in the same task.

## Token rules
- Grep/Glob before Read; read line ranges; never re-read a file just edited. Use Edit, not rewrites.
- Short replies; no repeating the plan. Limit long command output (head/tail).
- No web search, no unrelated files, no extra docs unless asked.
- Trivial tasks: do directly. Few agents, narrow task + file list each.
- One phase at a time; report in 3-5 lines.
- Model routing is in global CLAUDE.md (Critical tier -> Fable).
