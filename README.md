## CEDA — AI Code Guardrail & Audit Engine

**CEDA** is an automated code quality and security verification tool built to catch subtle bugs, hallucinations, and security flaws in AI-generated code (Cursor, GitHub Copilot, ChatGPT, Claude).

### Key Technical Capabilities:
- **Hallucination & Logic Detection:** Uses AST parsing and semantic evaluation to catch non-existent API methods and unhandled runtime exceptions.
- **Test Integrity Guardrails:** Detects when PRs modify existing unit tests to "cheat" passing status.
- **Secret & Security Scanning:** Scans git diffs for hardcoded API keys, unvalidated inputs, and framework anti-patterns.
- **High-Signal PR Reviews:** Posts a single, actionable risk assessment comment on GitHub Pull Requests with line-specific suggestions.
