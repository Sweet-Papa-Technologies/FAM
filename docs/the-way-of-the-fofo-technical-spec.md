# The Way of the FoFo — Technical Specification Baseline

**Purpose:** This document is the development bible for all Sweet Papa Technologies and Forrester Terry projects. It defines the tech stack, conventions, AI workflow, coding standards, and operational expectations that every human developer and AI coding agent must follow. Drop this into any new project as the starting point.

**Author:** Forrester Terry — Software Engineering Manager, Stanford University / Founder, Sweet Papa Technologies
**Version:** 1.0
**Last updated:** April 2026

---

## 0. Philosophy — read this first

This section is non-negotiable context. Every developer and AI agent working on a FoFo project must internalize these principles before writing a single line of code.

### The core tenets

**Frictionless. Optimized. Fun. Open.** — This is what FoFo stands for. Every architectural decision, every tool choice, every UX pattern should be evaluated against these four words. If something introduces unnecessary friction, isn't optimized for the actual problem, isn't enjoyable to use or build, or locks users/developers into closed ecosystems — it doesn't belong.

**Problem-first, always.** We don't pick technology and then find a use for it. We identify the problem, define success criteria, and then select the simplest technology that solves it. Code that solves actual problems is always more valued than code that's just "cool."

**AI is a force multiplier, not a replacement.** AI handles implementation. Humans handle architecture, security, context, and judgment. The working pattern:

1. You (the human) decide the approach. AI implements it.
2. You validate the output. AI iterates.
3. You catch the context-specific stuff — security, compliance, appropriateness.
4. You stay curious.

**Design for failure modes, not promises.** AI tools will hallucinate, regress working code, make silent architecture changes, inject vulnerabilities, and optimize for "works" over "appropriate." Every workflow in this document is designed around these failure modes.

**Ship early, iterate often.** Better to improve a shipped feature than over-engineer a never-released one. MVP first. Polish second. Perfection never.

**Systems over heroics.** We build sustainable processes that don't require 14-hour days. Consistency beats intensity. 70% every day beats 150% half the time.

---

## 1. Tech stack

### 1.1 Primary stack

This is the default stack for all new projects unless a specific technical requirement dictates otherwise. Deviations must be documented with rationale.

| Layer | Technology | Version (pin in package.json) | Notes |
|-------|-----------|-------------------------------|-------|
| **Language** | TypeScript | Latest stable | All projects. No vanilla JS in production code. Type safety catches AI mistakes early. |
| **Frontend framework** | Vue.js 3 + Quasar Framework | Vue 3.x, Quasar 2.x | Single codebase → web, mobile, desktop. Quasar's component library is the default UI kit. |
| **Backend** | Node.js + Express | Node LTS, Express 4.x+ | Same language front and back. Keep backend logic thin — route → validate → service → respond. |
| **Database** | Firebase Firestore | Latest SDK | Default for most projects. Zero-config, real-time sync, generous free tier. |
| **Auth** | Firebase Authentication | Latest SDK | Email/password + Google sign-in as baseline. Custom claims for role-based access. |
| **Storage** | Firebase Storage | Latest SDK | For user uploads and built artifacts. Never public — always authenticated download URLs. |
| **Mobile** | Capacitor (via Quasar) | Latest stable | Native bridge from web code. No separate Swift/Kotlin unless absolutely required. |
| **Desktop** | Electron (via Quasar) | Latest stable via Quasar | Same codebase → desktop app. Used in FoFo Care, Cardinal Support. |
| **Styling** | Quasar built-in + Tailwind CSS (optional) | — | Quasar components first. Tailwind for custom layouts. No raw CSS files unless scoped. |
| **Testing** | Vitest (unit) + Playwright (E2E) | Latest stable | Both are required for any project that ships to users. |
| **Version control** | Git + GitHub (SPT) / GitLab (Stanford) | — | Non-negotiable. Every project gets a repo on Day 0. |
| **Package manager** | npm | Latest LTS | Standard. Lock file committed always. |
| **Linting** | ESLint + Prettier | Project-specific config | Auto-format on save. No style debates — Prettier decides. |

### 1.2 AI tool stack

| Tool | Role | When to use |
|------|------|-------------|
| **Claude** (chat + Claude Code CLI) | Primary AI pair programmer | Planning conversations (chat), implementation (Code CLI), code review |
| **ChatGPT** | Secondary AI / brainstorming / alternatives | When you need a different perspective or Claude is struggling with a specific task |
| **Gemini** | Research + long-context analysis | Deep Research for market/tech validation, NotebookLM for document analysis |
| **GitHub Copilot / Cursor / Windsurf** | Inline code completion + AI-native IDE | Day-to-day coding flow. Copilot for completions, Cursor/Windsurf for larger edits |
| **Ollama + LM Studio** | Local model runner | Privacy-sensitive work, cost optimization, offline development, understanding how models work |
| **LiteLLM** | Unified API proxy | When running multiple models (local + cloud) behind a single API interface |

### 1.3 Infrastructure & DevOps

| Tool | Role | Notes |
|------|------|-------|
| **Firebase Hosting** | Web deployment | Default for all web projects. SSL, CDN, versioning built in. |
| **Firebase Cloud Functions** | Serverless backend / API gateway | For projects that need a backend proxy or scheduled tasks. |
| **Docker / Docker Compose** | Containerization | Required for server-hosted projects (WARLOCK). Each service gets its own container. |
| **Terraform** | Infrastructure as Code | For Stanford and multi-environment projects. State files managed per environment. |
| **GitHub Actions** | CI/CD | Lint → test → build → deploy on push/merge. Required for shipped projects. |
| **Vercel / Netlify** | Alternative web deployment | For simple static sites or when Firebase is overkill. |

### 1.4 The WARLOCK server (local infrastructure)

For projects that run on local hardware:

```
Processor: i5 9400F 2.9GHz (6 cores)
System RAM: 48GB
GPUs: RTX 3050 (8GB) + RTX 3060 (12GB)
Storage: 1TB SSD
OS: Ubuntu Server (headless)
```

Container resource allocation guidelines:

| Service type | RAM | GPU | Notes |
|-------------|-----|-----|-------|
| Image processing | 8GB | Optional (GPU acceleration) | ImageMagick or CodeProject.AI |
| Video/audio processing | 12GB | Preferred (transcoding) | FFMPEG-based |
| AI / LLM operations | 16GB+ | Primary GPU access | Ollama, vLLM, or custom |
| Developer tools / utilities | 4GB | None (CPU only) | Express-based microservices |
| Queue / broker | 2GB | None | Redis or BullMQ |

---

## 2. The development pipeline — "How I Code"

This is the mandatory workflow for any project beyond a throwaway prototype. Each phase produces artifacts that feed the next.

### Phase 1: Brainstorm & explore

**Where:** Google Drive / Docs
**Who:** Human (with AI assist for research and feedback)

1. Open a Google Doc. Brainstorm freely — available resources, approaches, ideas, assumptions, constraints
2. Share the doc with an AI (Claude or ChatGPT). Get feedback, identify blind spots, iterate
3. Use Gemini Deep Research or NotebookLM to validate technical choices and market assumptions
4. Save relevant AI sessions and research to a project folder in Drive: `Discovery / Early Requirements`

**Output:** A brainstorming document with validated assumptions and initial direction.

### Phase 2: Requirements

**Where:** Google Docs → committed to repo as `REQUIREMENTS.md`
**Who:** Human decides, AI helps formalize

1. Take the brainstorming artifacts and formalize into a proper requirements document with AI assistance
2. Review critically — does this actually describe what you want? Does it cover the MVP completely?
3. The requirements doc must be specific enough that an AI coder can build from it without guessing

**Output:** `REQUIREMENTS.md` committed to repo.

### Phase 3: Design

**Where:** Repo as `DESIGN.md` (and optionally `UI_UX_NOTES.md`)
**Who:** AI drafts, human reviews, second AI peer-reviews

1. Feed the requirements doc to an AI. Have it produce a design document
2. Review the design manually — does the architecture make sense? Are there gaps?
3. Have a DIFFERENT AI instance (or different model) review the design for blind spots
4. Lock in the design doc
5. Create UI/UX notes if the project has a user interface

**Output:** `DESIGN.md` and optionally `UI_UX_NOTES.md` committed to repo.

### Phase 4: Task breakdown

**Where:** Jira (Stanford) / GitHub Issues (SPT) / Confluence
**Who:** AI proposes breakdown, human validates feasibility

1. Feed the design doc to an AI and request: Epics → Stories → Tasks → Subtasks with Definition of Done, testing requirements, and implementation notes
2. For Jira/Confluence projects, use MCP to create tickets directly:

```
Prompt template:
"I have this project I am working on, and have attached all the details.
Please make Jira tickets and any relevant Confluence documentation to
help guide me and my A.I. programmer through implementation. Break things
down into Epics, Stories, Tasks, SubTasks, etc, and fill with relevant
details and Definition of Done, testing requirements, and notes from the
design docs etc. My Jira key is `[KEY]` and Confluence key is `[SPACE]`"
```

3. AND/OR: Create a `CLAUDE.md` (or `.claude/` folder with agents) to keep agentic coders grounded in the project context

**Output:** Ticketed backlog and/or CLAUDE.md project file.

### Phase 5: Development

**Where:** IDE + AI coding tools
**Who:** Human architects, AI implements, human reviews

The daily loop:

1. Review previous work (human)
2. Identify today's goals (human + AI)
3. AI implements features based on tickets/specs
4. Human tests in the actual environment
5. AI fixes issues based on human feedback
6. Human validates fixes
7. Commit and document

Critical rules during development:

- **Commit before every significant AI change.** Git is your undo button.
- **Fresh sessions for new features.** Long conversations degrade AI output quality.
- **Separate "thinking" from "building" conversations.** Research and planning in one session, implementation in another.
- **Prepare boilerplate before engaging AI.** Scaffold the project structure, install dependencies, create the file tree — then hand off implementation.
- **Multi-agent when possible.** Spawn parallel task agents for independent components (e.g., DebugAgent, TestAgent, DocAgent in `.claude/agents/`).

### Phase 6: Testing

- Unit tests with Vitest for all business logic
- E2E tests with Playwright for critical user flows
- AI writes tests, but human reviews test quality (does it actually test what matters?)
- Tests must pass before any merge to main

### Phase 7: Release

- Deploy to staging/UAT first
- Test in production-like environment (AI can't do this for you — dev ≠ prod bugs are real)
- Deploy to production
- Monitor for errors (Sentry or equivalent)

### Phase 8: Post-release

- Update documentation
- Retrospective (even solo — what worked, what didn't, what to change)
- Archive AI sessions that contain useful patterns or decisions

---

## 3. Project structure conventions

### 3.1 Standard Quasar project layout

```
project-root/
├── .claude/                    # Claude Code agent configs (if using agents)
│   └── agents/                 # Specialized agents (DebugAgent, TestAgent, etc.)
├── .github/
│   └── workflows/              # GitHub Actions CI/CD
├── docs/
│   ├── REQUIREMENTS.md         # Formal requirements
│   ├── DESIGN.md               # Architecture and design decisions
│   ├── UI_UX_NOTES.md          # UI/UX specifications (if applicable)
│   └── CHANGELOG.md            # Release notes
├── src/
│   ├── assets/                 # Static assets (images, fonts)
│   ├── boot/                   # Quasar boot files (Firebase init, auth, etc.)
│   ├── components/             # Reusable Vue components
│   │   └── [FeatureName]/      # Group by feature, not by type
│   ├── composables/            # Vue composables (shared reactive logic)
│   ├── layouts/                # Page layouts
│   ├── pages/                  # Route-level pages
│   ├── router/                 # Vue Router config
│   ├── services/               # API calls, Firebase interactions, business logic
│   ├── stores/                 # Pinia stores
│   ├── types/                  # TypeScript type definitions
│   └── utils/                  # Pure utility functions
├── src-electron/               # Electron main process (desktop builds)
├── src-capacitor/              # Capacitor config (mobile builds)
├── test/
│   ├── unit/                   # Vitest unit tests
│   └── e2e/                    # Playwright E2E tests
├── CLAUDE.md                   # AI coder project instructions
├── .env.example                # Environment variable template (never commit .env)
├── .eslintrc.js                # ESLint config
├── .prettierrc                 # Prettier config
├── quasar.config.js            # Quasar build config
├── tsconfig.json               # TypeScript config
├── package.json
└── README.md
```

### 3.2 Backend project layout (Express + Firebase Functions)

```
functions/
├── src/
│   ├── index.ts                # Function exports
│   ├── middleware/              # Auth, rate limiting, error handling
│   ├── routes/                 # Express route handlers grouped by domain
│   ├── services/               # Business logic (no Express req/res here)
│   ├── types/                  # Shared TypeScript types
│   ├── utils/                  # Pure utilities
│   └── config/                 # Environment config, Firebase init
├── test/
├── .eslintrc.js
├── tsconfig.json
└── package.json
```

### 3.3 Docker project layout (WARLOCK-hosted services)

```
project-root/
├── docker-compose.yml          # Orchestration for all services
├── .env.example                # Environment template
├── services/
│   ├── broker/                 # Job queue/broker API
│   │   ├── Dockerfile
│   │   └── src/
│   ├── image-processing/       # ImageMagick/AI image service
│   │   ├── Dockerfile
│   │   └── src/
│   ├── video-audio/            # FFMPEG service
│   │   ├── Dockerfile
│   │   └── src/
│   └── ai/                     # LLM service (LiteLLM, Ollama, etc.)
│       ├── Dockerfile
│       └── src/
├── scripts/
│   ├── setup.sh                # macOS/Linux setup script
│   └── setup.ps1               # Windows setup script
└── docs/
```

---

## 4. Coding standards

### 4.1 TypeScript conventions

```typescript
// Naming conventions
const myVariable = 'camelCase for variables and functions'
const MY_CONSTANT = 'SCREAMING_SNAKE for true constants'

interface UserProfile { }       // PascalCase for interfaces and types
type ApiResponse = { }          // PascalCase for type aliases
enum UserRole { }               // PascalCase for enums

class AuthService { }           // PascalCase for classes
function getUserById() { }      // camelCase for functions
const handleClick = () => { }   // camelCase for arrow functions

// File naming
// my-component.vue              — kebab-case for Vue components (Quasar convention)
// auth.service.ts               — dot-notation for service files
// user.types.ts                 — dot-notation for type files
// useAuth.ts                    — camelCase for composables (Vue convention)
```

### 4.2 Vue/Quasar conventions

```vue
<!-- Component structure order -->
<template>
  <!-- Template first — what users see -->
</template>

<script setup lang="ts">
// Composition API with <script setup> — ALWAYS
// No Options API unless maintaining legacy code

// Import order:
// 1. Vue/Quasar imports
// 2. Third-party imports
// 3. Local imports (composables, services, types)
// 4. Component imports

import { ref, computed, onMounted } from 'vue'
import { useQuasar } from 'quasar'
import { useAuth } from 'src/composables/useAuth'
import type { UserProfile } from 'src/types/user.types'
</script>

<style scoped lang="scss">
/* Scoped styles ONLY — never leak styles globally */
/* Prefer Quasar classes and Tailwind utilities over custom CSS */
</style>
```

### 4.3 API design patterns

All API endpoints follow this response structure:

```typescript
// Success response
{
  success: true,
  data: { /* payload */ },
  message?: 'Optional human-readable message'
}

// Error response
{
  success: false,
  error: {
    code: 'ERROR_CODE',        // Machine-readable
    message: 'What went wrong' // Human-readable
  }
}

// Job/async response (for long-running tasks)
{
  success: true,
  data: {
    jobId: 'uuid',
    status: 'queued' | 'processing' | 'completed' | 'failed',
    estimatedTime?: number     // seconds
  }
}
```

### 4.4 Error handling patterns

```typescript
// Services throw typed errors
class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500
  ) {
    super(message)
  }
}

// Routes catch and format
app.use((err: AppError, req: Request, res: Response, next: NextFunction) => {
  res.status(err.statusCode).json({
    success: false,
    error: {
      code: err.code,
      message: err.message
    }
  })
})
```

### 4.5 Things that are always required

- **No `any` types.** If you don't know the type, define an interface. `unknown` is acceptable as a stepping stone.
- **No console.log in production.** Use a proper logger (e.g., `winston`, `pino`, or Quasar's built-in logger).
- **No hardcoded secrets.** Environment variables via `.env` files, never committed. Firebase config is the exception (it's designed to be public).
- **No raw SQL or unvalidated user input.** Use parameterized queries. Validate with Zod or equivalent.
- **Descriptive commit messages.** Format: `type(scope): description` — e.g., `feat(auth): add Google sign-in`, `fix(api): handle null response from Firestore`

---

## 5. AI coding rules — the twelve golden rules

These rules apply to every AI coding session, whether using Claude Code, Copilot, Cursor, or any other tool.

### Rule 1: Documentation is AI memory
Every major project begins with the AI reading `REQUIREMENTS.md`, `DESIGN.md`, and `CLAUDE.md`. Without these, the AI is guessing. With these, it has institutional knowledge.

### Rule 2: AI is a force multiplier, not a replacement
You need to understand what you're building. The realistic contribution ratio is 60/40 or 70/30 (human-to-AI). AI handles implementation; you handle architecture, security, and judgment.

### Rule 3: Test suites are your safety net
AI generates code fast. Tests tell you whether that code actually works. Without them, speed is a liability. Make AI write tests. Then review whether the tests actually test what matters.

### Rule 4: Design before code
The full pipeline: brainstorm → requirements → design → develop → test → release. Never skip straight to prompting.

### Rule 5: Context is everything
Quality degrades in longer conversations. Start fresh sessions for new features or components. Use the "master prompt" technique — have AI keep running notes of progress and next steps that you can paste into the next session.

### Rule 6: Fight for simplicity
Complexity is the enemy. AI will over-engineer if you let it. Simple, modular systems are easier for both humans and AI to reason about. Push back when AI introduces unnecessary abstraction.

### Rule 7: Security cannot be delegated
AI optimizes for "does it work." You optimize for "is this appropriate." Always review for:
- Hardcoded credentials or API keys
- Missing input validation
- Overly permissive CORS or security rules
- Unintended permission escalations
- SQL injection or equivalent injection attacks
- Silent architecture changes (AI switching from pipes to websockets, etc.)

**The AI doesn't understand the blast radius of infrastructure changes the way you do.**

### Rule 8: Build custom tools
When you find yourself repeating a workflow, build a tool. eGit (AI Git workflows), FoFo Docs (documentation generator), CouchDev (remote Claude Code control) — each tool encodes domain expertise into reusable infrastructure.

### Rule 9: Parallel development works
Multiple AI sessions handling different components simultaneously, with human coordination. Use `.claude/agents/` for specialized agents (DebugAgent, TestAgent, DocAgent). Spawn task agents for independent work streams.

### Rule 10: Manage costs actively
- Test with the best, deploy with the efficient — use expensive models (Opus, GPT-4) for validation and architecture review, cheaper models (Sonnet, Haiku, local) for routine implementation
- Monitor token usage and API costs weekly
- Use local models (Ollama) when cloud isn't required
- Cache system prompts when possible
- Use RAG instead of stuffing full documents into context

### Rule 11: Version control everything
Git commit before every significant AI change. Feature branches for each AI session. Main branch protected. If AI breaks something, you can always roll back.

### Rule 12: Fresh sessions prevent drift
Long conversations cause the AI to forget initial requirements, suggest already-tried solutions, and contradict itself. Start new sessions for new components. Always reference docs, never rely on AI memory alone.

---

## 6. CLAUDE.md template

Every project gets a `CLAUDE.md` file at the root. Here's the template:

```markdown
# [Project Name] — Development Guide

## Project overview
[2-3 sentences describing what this project does and why it exists]

## Architecture
[Brief description of the architecture — what talks to what]

## Tech stack
[List of technologies used — reference The Way of the FoFo for defaults]

## Key files
- `docs/REQUIREMENTS.md` — What we're building
- `docs/DESIGN.md` — How we're building it
- `src/` — Frontend source
- `functions/` — Backend source (if applicable)

## Development workflow
1. Read REQUIREMENTS.md and DESIGN.md before making changes
2. Work on one milestone/ticket at a time
3. Implement → test → iterate → commit
4. Ask for clarification when requirements are ambiguous — don't guess

## Coding standards
- TypeScript always, no `any` types
- Vue 3 Composition API with `<script setup>`
- Quasar components preferred over custom UI
- All API responses follow the standard success/error format
- Scoped styles only

## What NOT to do
- Do NOT change architecture without explicit human approval
- Do NOT remove or modify existing tests without explanation
- Do NOT hardcode secrets, API keys, or environment-specific values
- Do NOT introduce new dependencies without stating why
- Do NOT write deployment scripts that could have destructive side effects without flagging them
- Do NOT optimize for "works" at the expense of security or maintainability

## Working with me
- I will specify which milestone or component we're working on
- When I give you an error, provide a targeted fix — don't refactor unrelated code
- If you're unsure about a requirement, ask — don't assume
- Explain non-obvious decisions briefly
- Commit frequently with descriptive messages
```

---

## 7. Security baseline

These are non-negotiable for any project that touches user data or deploys to production.

### Authentication & authorization
- Firebase Auth as the default identity provider
- Custom claims for role-based access (e.g., `{ bAllowed: true, isAdmin: true }`)
- Firestore security rules that enforce auth at the database level — never rely solely on frontend checks
- Refresh token rotation enabled
- Session timeout appropriate to the application

### Data protection
- No PII in logs
- Firestore security rules: deny by default, allow by exception
- Firebase Storage: authenticated download URLs only — never public buckets
- Environment variables for all secrets — `.env` never committed, `.env.example` always committed
- For Stanford projects: comply with all university data classification requirements

### Infrastructure
- HTTPS everywhere (Firebase Hosting handles this automatically)
- Rate limiting on all public APIs (Firebase Functions and Express)
- Docker containers run as non-root users
- No exposed ports beyond what's necessary
- Terraform state files stored securely (not in public repos)
- Code signing for desktop apps (macOS, Windows)

### AI-specific security
- Never feed production credentials, API keys, or user data into AI chat sessions
- Review all AI-generated deployment scripts for destructive operations
- Review all AI-generated security rules and auth logic manually
- Treat AI-generated code as untrusted input — validate before deploying

---

## 8. Testing requirements

### Minimum test coverage for shipped projects

| Layer | Tool | Minimum requirement |
|-------|------|-------------------|
| Unit tests | Vitest | All service/utility functions. All Pinia store actions. All composables. |
| Component tests | Vitest + Vue Test Utils | Critical UI components (forms, auth flows, data displays) |
| E2E tests | Playwright | Critical user journeys: sign up, sign in, core feature flow, error handling |
| API tests | Vitest or Supertest | All endpoints: happy path + error cases + auth enforcement |

### Testing methodology with AI

1. Write the test first when possible (test-driven)
2. When AI writes code, tell it to write tests alongside
3. After AI writes tests, review: does the test actually verify the behavior, or just assert that the function returns something?
4. AI-generated tests often test implementation details rather than behavior — redirect toward behavior testing
5. Integration tests are more valuable than exhaustive unit tests for AI-generated code

---

## 9. Documentation requirements

Every shipped project must have:

| Document | Location | Content |
|----------|----------|---------|
| `README.md` | Repo root | What it is, how to install, how to run, how to deploy. Assumes the reader is a developer. |
| `REQUIREMENTS.md` | `/docs` | What we're building and why. Functional and non-functional requirements. |
| `DESIGN.md` | `/docs` | How we're building it. Architecture, data model, API contracts, key decisions. |
| `CLAUDE.md` | Repo root | AI coder instructions (see template in Section 6). |
| `CHANGELOG.md` | `/docs` or repo root | What changed in each release. |
| `.env.example` | Repo root | All required environment variables with descriptions. No actual values. |
| Inline code comments | In code | Explain WHY, not WHAT. The code shows what — comments explain intent. |

---

## 10. Deployment patterns

### Pattern A: Firebase-hosted web app (most common)

```
Local dev → GitHub push → GitHub Actions (lint + test) → Firebase deploy (preview) → Manual promote to production
```

### Pattern B: Firebase + Cloud Functions backend

```
Local dev → GitHub push → GitHub Actions (lint + test + functions test) → Deploy functions to staging → Test staging → Promote to production
```

### Pattern C: Docker on WARLOCK

```
Local dev → GitHub push → SSH to WARLOCK → docker-compose pull + up → Health check verification
```

### Pattern D: Multi-target (web + mobile + desktop)

```
Local dev → GitHub push → GitHub Actions:
  ├── Web: Firebase deploy
  ├── Android: Capacitor build → APK/AAB → Play Store (or TestFlight equivalent)
  └── Desktop: Electron build → Code sign → Distribute
```

### Environment management

All projects with a backend maintain three environments:

| Environment | Purpose | Deploy trigger |
|-------------|---------|---------------|
| `dev` | Local development | Manual |
| `uat` / `staging` | Pre-production validation | Push to `staging` branch or manual |
| `prod` | Production | Manual promotion from UAT after validation |

---

## 11. Quick-start checklist for new projects

When starting a new project, execute this checklist in order:

```
[ ] Create Google Doc for brainstorming
[ ] Brainstorm and validate with AI research
[ ] Write REQUIREMENTS.md
[ ] Write DESIGN.md (AI drafts, you review, second AI peer-reviews)
[ ] Create GitHub/GitLab repo
[ ] Scaffold project:
    [ ] `npm init quasar` (for frontend projects)
    [ ] Configure TypeScript, ESLint, Prettier
    [ ] Create folder structure per Section 3
    [ ] Create .env.example
    [ ] Create CLAUDE.md from template
    [ ] Commit docs (REQUIREMENTS.md, DESIGN.md, CLAUDE.md)
[ ] Set up CI/CD:
    [ ] GitHub Actions workflow (lint + test + build)
    [ ] Firebase project (if applicable)
    [ ] Deployment targets (dev/staging/prod)
[ ] Create task breakdown (Jira tickets or GitHub Issues)
[ ] Begin development — one milestone at a time
[ ] Write tests alongside implementation
[ ] Deploy to staging for validation
[ ] Deploy to production
[ ] Post-release: update docs, retrospective, archive sessions
```

---

## 12. The meta-rule

When in doubt about any decision — architectural, stylistic, procedural, or technical — apply the FoFo filter:

- **Frictionless:** Does this reduce friction for the user and the developer?
- **Optimized:** Is this the simplest solution that solves the actual problem?
- **Fun:** Is this enjoyable to build and use?
- **Open:** Does this avoid unnecessary lock-in?

If the answer to all four is yes, ship it. If not, simplify until it is.

---

*This document is version-controlled and lives in every project repo. When the industry changes, the tools section updates. When we learn a better pattern, the conventions section updates. The philosophy section doesn't change — it's the foundation everything else is built on.*

*Build the thing. Ship the thing. Iterate on the thing.*

*— The Way of the FoFo*
