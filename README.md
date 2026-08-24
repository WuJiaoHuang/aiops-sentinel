# AIOps Sentinel

AIOps Sentinel is a full-stack AI operations platform for incident triage, service diagnostics, and release-risk decisions. It is designed as a portfolio-grade project that combines React, TypeScript, Node.js, CLI workflows, MCP-style tools, and an AI Agent diagnosis flow.

## Features

- Incident console with service status, metrics, logs, evidence chain, and AI diagnosis.
- Node.js API for services, logs, metrics, tool calls, and incident diagnosis.
- MCP-style tool layer for log search, metric query, dependency trace, incident summary, and rollback advice.
- DeepSeek integration with mock fallback when `DEEPSEEK_API_KEY` is not configured.
- Local CLI for scanning services, diagnosing incidents, reading logs, and generating reports.
- Rules, Skills, and Prompt assets for AI Coding workflow practice.

## Tech Stack

- Frontend: HTML5, CSS3, JavaScript, TypeScript, React, Vite
- Backend: Node.js, TypeScript, Express
- AI: DeepSeek API, Agent workflow, prompt templates
- Engineering: CLI, MCP-style tool contracts, Rules, Skills, ESLint, TypeScript checks

## Getting Started

```bash
npm install
npm run dev:api
npm run dev
```

Create a local `.env` from `.env.example` when using DeepSeek:

```bash
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

## CLI

```bash
npm run cli -- scan
npm run cli -- diagnose inc-20260824-001
npm run cli -- logs svc-order
npm run cli -- report inc-20260824-001
```

## Project Structure

```text
apps/web        React operation console
apps/api        Node.js API service
packages/core   Mock data, MCP tools, Agent workflow, DeepSeek adapter
packages/cli    Local Sentinel CLI
rules           AI Coding rules
skills          Reusable AI workflow skills
prompts         Agent prompt templates
docs            Architecture and resume notes
```
