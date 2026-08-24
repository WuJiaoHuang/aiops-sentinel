# Backend Rules

- Keep API handlers thin and move diagnosis logic into core services.
- Return typed JSON payloads and clear error messages.
- Keep DeepSeek credentials in environment variables only.
- Do not commit `.env` files or real incident data.
- Preserve MCP-style tool contracts across API and CLI usage.
